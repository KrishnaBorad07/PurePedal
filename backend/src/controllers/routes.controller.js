const { pool } = require("../db/connection");
const routeCache = require("../services/routeCache");
const scoringClient = require("../services/scoringClient");
const { isValidLatLng, haversineDistance } = require("../utils/geo");
const { OrsApiError, OrsNoRouteError, ScoringServiceError } = require("../utils/errors");

const DEFAULT_WEIGHTS = { aqi: 0.6, distance: 0.25, elevation: 0.15 };
const FREE_ROUTE_LIMIT = 3;
const ROUTE_LABELS = ["Cleanest", "Alternative", "Fastest"];

function parseLatLng(obj) {
  if (!obj || typeof obj !== "object") return null;
  const lat = parseFloat(obj.lat);
  const lng = parseFloat(obj.lng);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

function resolveWeights(dbUser, preferences) {
  const isPremium = dbUser.subscription_status === "premium";
  if (isPremium && preferences?.weights) {
    return preferences.weights;
  }
  return dbUser.scoring_weights ?? DEFAULT_WEIGHTS;
}

async function suggestRoutes(req, res, next) {
  try {
    const origin = parseLatLng(req.body.origin);
    const destination = parseLatLng(req.body.destination);

    if (!origin) {
      return res.status(400).json({ error: "origin must have valid lat and lng." });
    }
    if (!destination) {
      return res.status(400).json({ error: "destination must have valid lat and lng." });
    }
    if (!isValidLatLng(origin.lat, origin.lng)) {
      return res.status(400).json({ error: "origin coordinates out of valid range." });
    }
    if (!isValidLatLng(destination.lat, destination.lng)) {
      return res.status(400).json({ error: "destination coordinates out of valid range." });
    }

    const dist = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
    if (dist < 10) {
      return res.status(400).json({ error: "Origin and destination cannot be the same location." });
    }
    if (dist > 100_000) {
      return res.status(400).json({ error: "Destination is too far. Maximum route distance is 100km." });
    }

    const weights = resolveWeights(req.dbUser, req.body.preferences);
    const { routes, cached } = await routeCache.getRoutes(origin, destination);
    const scored = await scoringClient.scoreRoutes(routes, weights, req.dbUser.id);

    const labelledRoutes = scored.routes.map((route, i) => ({
      ...route,
      label: ROUTE_LABELS[i] ?? "Alternative",
    }));

    return res.json({
      routes: labelledRoutes,
      recommendedRouteId: labelledRoutes[0]?.id ?? null,
      origin,
      destination,
      cachedRoutes: cached,
    });
  } catch (err) {
    if (err instanceof OrsNoRouteError) {
      return res.status(422).json({ error: err.message });
    }
    if (err instanceof OrsApiError) {
      return res.status(502).json({ error: "OpenRouteService request failed." });
    }
    if (err instanceof ScoringServiceError) {
      const status = err.isTimeout ? 504 : 502;
      return res.status(status).json({ error: "Scoring service temporarily unavailable." });
    }
    next(err);
  }
}

async function getSavedRoutes(req, res, next) {
  try {
    const isPremium = req.dbUser.subscription_status === "premium";
    const limit = isPremium ? null : FREE_ROUTE_LIMIT;

    const result = await pool.query(
      `SELECT id, name, distance_m, elevation_gain_m, aqi_at_save, tags, collection_id, created_at
       FROM saved_routes
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.dbUser.id]
    );

    const routes = result.rows;
    const canSaveMore = isPremium ? true : routes.length < FREE_ROUTE_LIMIT;

    return res.json({ routes, count: routes.length, limit, canSaveMore });
  } catch (err) {
    next(err);
  }
}

async function saveRoute(req, res, next) {
  try {
    const { name, geometry, distance_m, elevation_gain_m, aqi_at_save, tags } = req.body;
    const isPremium = req.dbUser.subscription_status === "premium";

    // Validate name
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required." });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: "name must be 100 characters or fewer." });
    }

    // Validate geometry
    if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      return res.status(400).json({ error: "geometry must be a valid GeoJSON LineString with at least 2 coordinates." });
    }

    // Validate distance_m
    if (!Number.isInteger(distance_m) || distance_m <= 0) {
      return res.status(400).json({ error: "distance_m must be a positive integer." });
    }

    // Validate elevation_gain_m
    if (elevation_gain_m !== undefined && elevation_gain_m !== null) {
      if (!Number.isInteger(elevation_gain_m) || elevation_gain_m < 0) {
        return res.status(400).json({ error: "elevation_gain_m must be a non-negative integer." });
      }
    }

    // Validate aqi_at_save
    if (aqi_at_save !== undefined && aqi_at_save !== null) {
      const aqi = parseFloat(aqi_at_save);
      if (isNaN(aqi) || aqi < 0 || aqi > 500) {
        return res.status(400).json({ error: "aqi_at_save must be a number between 0 and 500." });
      }
    }

    // Validate and filter tags
    let resolvedTags = [];
    if (isPremium && Array.isArray(tags)) {
      if (tags.length > 5) {
        return res.status(400).json({ error: "tags must have 5 items or fewer." });
      }
      for (const tag of tags) {
        if (typeof tag !== "string" || tag.length > 30) {
          return res.status(400).json({ error: "Each tag must be a string of 30 characters or fewer." });
        }
      }
      resolvedTags = tags;
    }

    // Free-tier cap enforcement
    if (!isPremium) {
      const countResult = await pool.query(
        "SELECT COUNT(*) FROM saved_routes WHERE user_id = $1",
        [req.dbUser.id]
      );
      if (parseInt(countResult.rows[0].count, 10) >= FREE_ROUTE_LIMIT) {
        return res.status(403).json({
          error: "You have reached the free tier limit of 3 saved routes.",
          upgradeRequired: true,
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO saved_routes (user_id, name, geometry, distance_m, elevation_gain_m, aqi_at_save, tags)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3::text), 4326)::geography, $4, $5, $6, $7)
       RETURNING id, name, distance_m, elevation_gain_m, aqi_at_save, tags, collection_id, created_at`,
      [
        req.dbUser.id,
        name.trim(),
        JSON.stringify(geometry),
        distance_m,
        elevation_gain_m ?? 0,
        aqi_at_save ?? null,
        resolvedTags,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function deleteRoute(req, res, next) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT id, user_id FROM saved_routes WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Route not found." });
    }
    if (result.rows[0].user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to delete this route." });
    }

    await pool.query("DELETE FROM saved_routes WHERE id = $1", [id]);

    return res.json({ message: "Route deleted successfully." });
  } catch (err) {
    next(err);
  }
}

module.exports = { suggestRoutes, getSavedRoutes, saveRoute, deleteRoute };
