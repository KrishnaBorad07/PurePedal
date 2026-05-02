const { pool } = require("../db/connection");
const logger = require("../utils/logger");
const aqiCache = require("../services/aqiCache");
const { haversineDistance, isValidLatLng, simplifyTrack, sampleTrack } = require("../utils/geo");

function getCategory(aqi) {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy-for-sensitive-groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very-unhealthy";
  return "hazardous";
}

function computeWeekBoundaries(now = new Date()) {
  const day = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { weekStart: monday, weekEnd: sunday };
}

async function createRide(req, res, next) {
  try {
    const { startedAt, endedAt, track, savedRouteId = null } = req.body;

    if (!startedAt || !endedAt) {
      return res.status(400).json({ error: "startedAt and endedAt are required." });
    }
    const startDate = new Date(startedAt);
    const endDate = new Date(endedAt);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format." });
    }
    if (startDate >= endDate) {
      return res.status(400).json({ error: "startedAt must be before endedAt." });
    }
    if (endDate > new Date()) {
      return res.status(400).json({ error: "endedAt must not be in the future." });
    }
    const durationSeconds = Math.round((endDate - startDate) / 1000);
    if (durationSeconds < 60) {
      return res.status(400).json({ error: "Ride duration must be at least 60 seconds." });
    }

    if (
      !track ||
      track.type !== "LineString" ||
      !Array.isArray(track.coordinates) ||
      track.coordinates.length < 2
    ) {
      return res
        .status(400)
        .json({ error: "track must be a valid GeoJSON LineString with at least 2 coordinates." });
    }
    if (track.coordinates.length > 10000) {
      return res.status(400).json({ error: "Track exceeds maximum length." });
    }
    for (const coord of track.coordinates) {
      if (!Array.isArray(coord) || coord.length < 2 || !isValidLatLng(coord[1], coord[0])) {
        return res.status(400).json({ error: "Invalid coordinate in track." });
      }
    }

    if (savedRouteId) {
      const savedResult = await pool.query(
        "SELECT id, user_id FROM saved_routes WHERE id = $1",
        [savedRouteId]
      );
      if (savedResult.rows.length === 0) {
        return res.status(404).json({ error: "Saved route not found." });
      }
      if (savedResult.rows[0].user_id !== req.dbUser.id) {
        return res.status(403).json({ error: "Forbidden." });
      }
    }

    let distanceM = 0;
    for (let i = 0; i < track.coordinates.length - 1; i++) {
      const [lng1, lat1] = track.coordinates[i];
      const [lng2, lat2] = track.coordinates[i + 1];
      distanceM += haversineDistance(lat1, lng1, lat2, lng2);
    }
    distanceM = Math.round(distanceM);

    const samples = sampleTrack(track.coordinates, 500, 50);
    const aqiValues = await Promise.all(
      samples.map((s) => aqiCache.getAqiForPoint(s.lat, s.lng))
    );
    const aqiSamples = samples.map((s, i) => ({
      lat: s.lat,
      lng: s.lng,
      aqi: aqiValues[i],
      distanceFromStart_m: s.distanceFromStart_m,
    }));

    const avgAqi = parseFloat(
      (aqiValues.reduce((sum, v) => sum + v, 0) / aqiValues.length).toFixed(1)
    );
    const maxAqi = Math.max(...aqiValues);

    const originalCount = track.coordinates.length;
    const simplifiedCoords = simplifyTrack(track.coordinates);
    logger.info({ originalCount, simplifiedCount: simplifiedCoords.length }, "Track simplified");

    const trackGeoJson = JSON.stringify({ type: "LineString", coordinates: simplifiedCoords });

    const result = await pool.query(
      `INSERT INTO rides (
        user_id, saved_route_id, started_at, ended_at,
        track_geometry, distance_m, duration_seconds, avg_aqi, max_aqi, aqi_samples
      ) VALUES ($1, $2, $3, $4, ST_GeogFromGeoJSON($5), $6, $7, $8, $9, $10)
      RETURNING id, created_at`,
      [
        req.dbUser.id,
        savedRouteId,
        startedAt,
        endedAt,
        trackGeoJson,
        distanceM,
        durationSeconds,
        avgAqi,
        maxAqi,
        JSON.stringify(aqiSamples),
      ]
    );

    const ride = result.rows[0];
    return res.status(201).json({
      id: ride.id,
      startedAt,
      endedAt,
      distance_m: distanceM,
      duration_seconds: durationSeconds,
      avg_aqi: avgAqi,
      max_aqi: maxAqi,
      savedRouteId,
      created_at: ride.created_at,
    });
  } catch (err) {
    next(err);
  }
}

async function getRides(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const [ridesResult, countResult] = await Promise.all([
      pool.query(
        `SELECT r.id, r.started_at, r.ended_at, r.distance_m, r.duration_seconds,
                r.avg_aqi, r.max_aqi, r.saved_route_id, r.created_at,
                sr.name AS saved_route_name
         FROM rides r
         LEFT JOIN saved_routes sr ON r.saved_route_id = sr.id
         WHERE r.user_id = $1
           AND ($2::timestamptz IS NULL OR r.started_at >= $2)
           AND ($3::timestamptz IS NULL OR r.started_at <= $3)
         ORDER BY r.started_at DESC
         LIMIT $4 OFFSET $5`,
        [req.dbUser.id, from, to, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM rides
         WHERE user_id = $1
           AND ($2::timestamptz IS NULL OR started_at >= $2)
           AND ($3::timestamptz IS NULL OR started_at <= $3)`,
        [req.dbUser.id, from, to]
      ),
    ]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const rides = ridesResult.rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      distance_m: r.distance_m,
      duration_seconds: r.duration_seconds,
      avg_aqi: r.avg_aqi,
      max_aqi: r.max_aqi,
      aqiCategory: getCategory(parseFloat(r.avg_aqi)),
      savedRouteId: r.saved_route_id,
      savedRouteName: r.saved_route_name,
      created_at: r.created_at,
    }));

    return res.status(200).json({
      rides,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getRideById(req, res, next) {
  try {
    const { id } = req.params;
    const isPremium = req.dbUser.subscription_status === "premium";

    const result = await pool.query(
      `SELECT r.id, r.user_id, r.started_at, r.ended_at, r.distance_m, r.duration_seconds,
              r.avg_aqi, r.max_aqi, r.saved_route_id, r.created_at,
              r.aqi_samples, ST_AsGeoJSON(r.track_geometry) AS track_geometry,
              sr.name AS saved_route_name
       FROM rides r
       LEFT JOIN saved_routes sr ON r.saved_route_id = sr.id
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ride not found." });
    }

    const r = result.rows[0];

    if (r.user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "Forbidden." });
    }

    const response = {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      distance_m: r.distance_m,
      duration_seconds: r.duration_seconds,
      avg_aqi: r.avg_aqi,
      max_aqi: r.max_aqi,
      aqiCategory: getCategory(parseFloat(r.avg_aqi)),
      savedRouteId: r.saved_route_id,
      savedRouteName: r.saved_route_name,
      created_at: r.created_at,
    };

    if (isPremium) {
      response.aqiSamples = r.aqi_samples;
      response.trackGeometry = JSON.parse(r.track_geometry);
    }

    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}

async function getWeeklySummary(req, res, next) {
  try {
    const { weekStart, weekEnd } = computeWeekBoundaries();

    const [aggResult, cleanestResult, pollutedResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total_rides,
                SUM(distance_m) AS total_distance_m,
                SUM(duration_seconds) AS total_duration_seconds,
                AVG(avg_aqi) AS avg_aqi
         FROM rides
         WHERE user_id = $1
           AND started_at >= $2
           AND started_at <= $3`,
        [req.dbUser.id, weekStart, weekEnd]
      ),
      pool.query(
        `SELECT id, started_at, distance_m, avg_aqi
         FROM rides
         WHERE user_id = $1
           AND started_at >= $2
           AND started_at <= $3
         ORDER BY avg_aqi ASC LIMIT 1`,
        [req.dbUser.id, weekStart, weekEnd]
      ),
      pool.query(
        `SELECT id, started_at, distance_m, avg_aqi
         FROM rides
         WHERE user_id = $1
           AND started_at >= $2
           AND started_at <= $3
         ORDER BY avg_aqi DESC LIMIT 1`,
        [req.dbUser.id, weekStart, weekEnd]
      ),
    ]);

    const agg = aggResult.rows[0];
    const totalRides = parseInt(agg.total_rides);

    if (totalRides === 0) {
      return res.status(200).json({
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        totalRides: 0,
        hasRides: false,
      });
    }

    const avgAqi = parseFloat(parseFloat(agg.avg_aqi).toFixed(1));
    const cleanest = cleanestResult.rows[0];
    const polluted = pollutedResult.rows[0];

    return res.status(200).json({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      totalRides,
      totalDistance_m: parseInt(agg.total_distance_m),
      totalDuration_seconds: parseInt(agg.total_duration_seconds),
      avgAqi,
      aqiCategory: getCategory(avgAqi),
      cleanestRide: {
        id: cleanest.id,
        startedAt: cleanest.started_at,
        distance_m: cleanest.distance_m,
        avg_aqi: parseFloat(cleanest.avg_aqi),
        aqiCategory: getCategory(parseFloat(cleanest.avg_aqi)),
      },
      mostPollutedRide: {
        id: polluted.id,
        startedAt: polluted.started_at,
        distance_m: polluted.distance_m,
        avg_aqi: parseFloat(polluted.avg_aqi),
        aqiCategory: getCategory(parseFloat(polluted.avg_aqi)),
      },
      hasRides: true,
    });
  } catch (err) {
    next(err);
  }
}

async function getBestTime(req, res, next) {
  try {
    const { home_location } = req.dbUser;

    if (!home_location) {
      return res
        .status(400)
        .json({ error: "Set your home location in your profile to use this feature." });
    }

    const lng = home_location.coordinates[0];
    const lat = home_location.coordinates[1];

    let currentAqi;
    try {
      currentAqi = await aqiCache.getAqiForPoint(lat, lng);
    } catch (err) {
      logger.error({ err }, "AQI fetch failed for best-time endpoint");
      return res.status(502).json({ error: "AQI data temporarily unavailable." });
    }

    const currentCategory = getCategory(currentAqi);
    let recommendation, suggestedWindows, message;

    if (currentAqi <= 50) {
      recommendation = "good";
      suggestedWindows = [];
      message = "Air quality is good right now. Great time to ride!";
    } else if (currentAqi <= 100) {
      recommendation = "moderate";
      suggestedWindows = [
        { label: "Early morning", from: "06:00", to: "08:00" },
        { label: "Evening", from: "18:00", to: "20:00" },
      ];
      message =
        "Air quality is moderate right now. Early morning or evening rides tend to have cleaner air.";
    } else {
      recommendation = "postpone";
      suggestedWindows = [];
      message = "Air quality is unhealthy right now. Consider postponing your ride.";
    }

    return res.status(200).json({
      currentAqi,
      currentCategory,
      recommendation,
      suggestedWindows,
      message,
      homeLocation: { lat, lng },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRide,
  getRides,
  getRideById,
  getWeeklySummary,
  getBestTime,
  getCategory,
  computeWeekBoundaries,
};
