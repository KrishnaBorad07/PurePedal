const { pool } = require("../db/connection");
const routeCache = require("../services/routeCache");
const scoringClient = require("../services/scoringClient");
const aqiCache = require("../services/aqiCache");
const { isValidLatLng, haversineDistance } = require("../utils/geo");
const { OrsApiError, OrsNoRouteError, ScoringServiceError } = require("../utils/errors");

const DEFAULT_WEIGHTS = { aqi: 0.6, distance: 0.25, elevation: 0.15 };
const FREE_ROUTE_LIMIT = 3;
const ROUTE_LABELS = ["Cleanest", "Alternative", "Fastest"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function isPremiumUser(dbUser) {
  return (
    dbUser.subscription_status === "premium" &&
    (dbUser.subscription_expires_at === null ||
      new Date(dbUser.subscription_expires_at) > new Date())
  );
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

    let forecastDate = null;
    let forecastAt = null;
    if (req.body.forecastAt !== undefined && isPremiumUser(req.dbUser)) {
      const ts = new Date(req.body.forecastAt);
      if (isNaN(ts.getTime())) {
        return res.status(400).json({ error: "forecastAt must be a valid ISO 8601 UTC timestamp." });
      }
      const diffMs = ts - Date.now();
      if (diffMs < 60 * 60 * 1000 || diffMs > 48 * 60 * 60 * 1000) {
        return res.status(400).json({ error: "Forecast routing is only available up to 48 hours in advance." });
      }
      forecastDate = ts.toISOString().slice(0, 10);
      forecastAt = req.body.forecastAt;
    }

    const { routes, cached } = await routeCache.getRoutes(origin, destination);
    const scored = await scoringClient.scoreRoutes(routes, weights, req.dbUser.id, forecastDate);

    const labelledRoutes = scored.routes.map((route, i) => ({
      ...route,
      label: ROUTE_LABELS[i] ?? "Alternative",
    }));

    return res.json({
      routes: labelledRoutes,
      recommendedRouteId: labelledRoutes[0]?.id ?? null,
      forecastAt: forecastAt,
      isForecast: forecastAt !== null,
      origin,
      destination,
      cachedRoutes: cached,
    });
  } catch (err) {
    if (err instanceof OrsNoRouteError) {
      return res.status(422).json({ error: err.message });
    }
    if (err instanceof OrsApiError) {
      return res.status(502).json({ error: err.message || "Error fetching routes from routing service." });
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
    const isPremium = isPremiumUser(req.dbUser);
    const limit = isPremium ? null : FREE_ROUTE_LIMIT;
    const tag = req.query.tag ? req.query.tag.toLowerCase() : null;
    const rawCollectionId = req.query.collectionId || null;

    const queryParams = [req.dbUser.id, tag];

    let collectionCondition;
    if (rawCollectionId === "uncollected") {
      collectionCondition = "sr.collection_id IS NULL";
    } else if (rawCollectionId) {
      queryParams.push(rawCollectionId);
      collectionCondition = `sr.collection_id = $${queryParams.length}::uuid`;
    } else {
      collectionCondition = "TRUE";
    }

    const result = await pool.query(
      `SELECT sr.id, sr.name, sr.distance_m, sr.elevation_gain_m, sr.aqi_at_save,
              sr.tags, sr.collection_id, sr.created_at, c.name AS collection_name
       FROM saved_routes sr
       LEFT JOIN collections c ON sr.collection_id = c.id
       WHERE sr.user_id = $1
         AND ($2::text IS NULL OR $2 = ANY(SELECT lower(unnest(sr.tags))))
         AND ${collectionCondition}
       ORDER BY sr.created_at DESC`,
      queryParams
    );

    const routes = result.rows;
    const canSaveMore = isPremium ? true : routes.length < FREE_ROUTE_LIMIT;

    return res.json({ routes, count: routes.length, limit, canSaveMore });
  } catch (err) {
    next(err);
  }
}

async function getSavedRoute(req, res, next) {
  try {
    const { id } = req.params;

    const existResult = await pool.query(
      "SELECT id, user_id FROM saved_routes WHERE id = $1",
      [id]
    );
    if (existResult.rows.length === 0) {
      return res.status(404).json({ error: "Route not found." });
    }
    if (existResult.rows[0].user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to view this route." });
    }

    const result = await pool.query(
      `SELECT sr.id, sr.name, ST_AsGeoJSON(sr.geometry)::jsonb AS geometry,
              sr.distance_m, sr.elevation_gain_m, sr.aqi_at_save, sr.tags,
              sr.collection_id, sr.aqi_samples, sr.score_breakdown, sr.created_at,
              c.name AS collection_name
       FROM saved_routes sr
       LEFT JOIN collections c ON sr.collection_id = c.id
       WHERE sr.id = $1`,
      [id]
    );

    const row = result.rows[0];
    const response = {
      id: row.id,
      name: row.name,
      distance_m: row.distance_m,
      elevation_gain_m: row.elevation_gain_m,
      aqi_at_save: row.aqi_at_save,
      tags: row.tags,
      collection_id: row.collection_id,
      collection_name: row.collection_name,
      created_at: row.created_at,
      geometry: row.geometry,
    };

    if (isPremiumUser(req.dbUser)) {
      response.aqiSamples = row.aqi_samples;
      response.scoreBreakdown = row.score_breakdown;
    }

    return res.json(response);
  } catch (err) {
    next(err);
  }
}

async function saveRoute(req, res, next) {
  try {
    const {
      name,
      geometry,
      distance_m,
      elevation_gain_m,
      aqi_at_save,
      tags,
      aqi_samples,
      score_breakdown,
    } = req.body;
    const isPremium = isPremiumUser(req.dbUser);

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required." });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: "name must be 100 characters or fewer." });
    }

    if (
      !geometry ||
      geometry.type !== "LineString" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2
    ) {
      return res.status(400).json({
        error: "geometry must be a valid GeoJSON LineString with at least 2 coordinates.",
      });
    }

    if (!Number.isInteger(distance_m) || distance_m <= 0) {
      return res.status(400).json({ error: "distance_m must be a positive integer." });
    }

    if (elevation_gain_m !== undefined && elevation_gain_m !== null) {
      if (!Number.isInteger(elevation_gain_m) || elevation_gain_m < 0) {
        return res.status(400).json({ error: "elevation_gain_m must be a non-negative integer." });
      }
    }

    if (aqi_at_save !== undefined && aqi_at_save !== null) {
      const aqi = parseFloat(aqi_at_save);
      if (isNaN(aqi) || aqi < 0 || aqi > 500) {
        return res.status(400).json({ error: "aqi_at_save must be a number between 0 and 500." });
      }
    }

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

    if (aqi_samples !== undefined && aqi_samples !== null) {
      if (!Array.isArray(aqi_samples)) {
        return res.status(400).json({ error: "aqi_samples must be an array." });
      }
      if (aqi_samples.length > 50) {
        return res.status(400).json({ error: "aqi_samples must have 50 items or fewer." });
      }
      for (const sample of aqi_samples) {
        if (
          typeof sample.lat !== "number" ||
          typeof sample.lng !== "number" ||
          !Number.isInteger(sample.aqi) ||
          sample.aqi < 0 ||
          sample.aqi > 500 ||
          !Number.isInteger(sample.distanceM) ||
          sample.distanceM < 0
        ) {
          return res.status(400).json({
            error:
              "Each aqi_samples item must have lat, lng (numbers), aqi (integer 0–500), and distanceM (non-negative integer).",
          });
        }
      }
    }

    if (score_breakdown !== undefined && score_breakdown !== null) {
      for (const key of ["final", "aqi", "distance", "elevation"]) {
        if (
          typeof score_breakdown[key] !== "number" ||
          score_breakdown[key] < 0 ||
          score_breakdown[key] > 100
        ) {
          return res.status(400).json({
            error: `score_breakdown.${key} must be a number between 0 and 100.`,
          });
        }
      }
    }

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
      `INSERT INTO saved_routes (
         user_id, name, geometry, distance_m, elevation_gain_m,
         aqi_at_save, tags, aqi_samples, score_breakdown
       ) VALUES (
         $1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3::text), 4326)::geography,
         $4, $5, $6, $7, $8, $9
       )
       RETURNING id, name, distance_m, elevation_gain_m, aqi_at_save,
                 tags, collection_id, created_at`,
      [
        req.dbUser.id,
        name.trim(),
        JSON.stringify(geometry),
        distance_m,
        elevation_gain_m ?? 0,
        aqi_at_save ?? null,
        resolvedTags,
        aqi_samples != null ? JSON.stringify(aqi_samples) : null,
        score_breakdown != null ? JSON.stringify(score_breakdown) : null,
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

async function assignRouteCollection(req, res, next) {
  try {
    const { id } = req.params;
    const { collectionId } = req.body;

    if (collectionId !== null && collectionId !== undefined) {
      if (typeof collectionId !== "string" || !UUID_RE.test(collectionId)) {
        return res.status(400).json({ error: "collectionId must be a valid UUID or null." });
      }
    }

    const routeResult = await pool.query(
      "SELECT id, user_id FROM saved_routes WHERE id = $1",
      [id]
    );
    if (routeResult.rows.length === 0) {
      return res.status(404).json({ error: "Route not found." });
    }
    if (routeResult.rows[0].user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to modify this route." });
    }

    if (collectionId) {
      const colResult = await pool.query(
        "SELECT id, user_id FROM collections WHERE id = $1",
        [collectionId]
      );
      if (colResult.rows.length === 0) {
        return res.status(404).json({ error: "Collection not found." });
      }
      if (colResult.rows[0].user_id !== req.dbUser.id) {
        return res.status(403).json({ error: "You do not have permission to use this collection." });
      }
    }

    const result = await pool.query(
      "UPDATE saved_routes SET collection_id = $1 WHERE id = $2 RETURNING id, collection_id",
      [collectionId ?? null, id]
    );

    const message = collectionId
      ? "Route moved to collection successfully."
      : "Route removed from collection successfully.";

    return res.json({
      id: result.rows[0].id,
      collectionId: result.rows[0].collection_id,
      message,
    });
  } catch (err) {
    next(err);
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function aqiRating(aqi) {
  if (aqi <= 50) return "excellent";
  if (aqi <= 100) return "good";
  if (aqi <= 150) return "fair";
  return "poor";
}

function dayLabel(dateStr) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  const d = new Date(dateStr + "T00:00:00Z");
  return DAY_NAMES[d.getUTCDay()];
}

async function getDepartureForecast(req, res, next) {
  try {
    const { id } = req.params;

    const routeResult = await pool.query(
      `SELECT id, user_id, name,
         ST_Y(ST_StartPoint(geometry::geometry)) AS origin_lat,
         ST_X(ST_StartPoint(geometry::geometry)) AS origin_lng
       FROM saved_routes WHERE id = $1`,
      [id]
    );

    if (routeResult.rows.length === 0) {
      return res.status(404).json({ error: "Route not found." });
    }
    const route = routeResult.rows[0];
    if (route.user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to view this route." });
    }

    const forecast = await aqiCache.getForecastForPoint(route.origin_lat, route.origin_lng);

    if (!forecast || !Array.isArray(forecast.forecast) || forecast.forecast.length === 0) {
      return res.status(404).json({
        error: "No forecast data available for this route's location.",
        cached: false,
      });
    }

    const days = forecast.forecast.slice(0, 7).map((day) => {
      const windows = [
        { label: "Early morning", from: "05:00", to: "08:00", estimatedAqi: day.min },
        { label: "Midday", from: "11:00", to: "14:00", estimatedAqi: day.avg },
        { label: "Evening", from: "17:00", to: "20:00", estimatedAqi: day.min },
      ].map((w) => ({ ...w, rating: aqiRating(w.estimatedAqi) }));

      const best = windows.reduce((a, b) => (a.estimatedAqi <= b.estimatedAqi ? a : b));

      return {
        date: day.day,
        dayLabel: dayLabel(day.day),
        avgAqi: day.avg,
        minAqi: day.min,
        maxAqi: day.max,
        overallRating: aqiRating(day.avg),
        windows,
        bestWindow: best.label,
      };
    });

    return res.json({
      routeId: route.id,
      routeName: route.name,
      originLat: route.origin_lat,
      originLng: route.origin_lng,
      forecastDays: days,
      daysReturned: days.length,
      cached: forecast.cached ?? false,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  suggestRoutes,
  getSavedRoutes,
  getSavedRoute,
  saveRoute,
  deleteRoute,
  assignRouteCollection,
  getDepartureForecast,
};
