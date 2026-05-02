const { redis } = require("../db/redis");
const { pool } = require("../db/connection");
const logger = require("../utils/logger");
const waqi = require("./waqi");
const { toGeohash, getBoundingBoxGeohashes } = require("../utils/geo");
const { CacheError, NoForecastAvailableError } = require("../utils/errors");

const TTL_POINT = 1800;
const TTL_BOUNDS = 1800;
const TTL_FORECAST = 3600;

async function redisGet(key) {
  try {
    return await redis.get(key);
  } catch (err) {
    throw new CacheError(err.message);
  }
}

async function redisSetex(key, ttl, value) {
  try {
    await redis.setex(key, ttl, value);
  } catch (err) {
    throw new CacheError(err.message);
  }
}

async function redisDel(key) {
  try {
    await redis.del(key);
  } catch (err) {
    throw new CacheError(err.message);
  }
}

function persistAqiHistory(reading, lat, lng) {
  pool
    .query(
      `INSERT INTO aqi_history (location, aqi_value, pollutant, source, recorded_at)
       VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4, $5, $6)`,
      [lng, lat, reading.aqi, reading.dominantPollutant, "waqi", reading.recordedAt]
    )
    .catch((err) => logger.error({ err }, "Failed to persist aqi_history"));
}

async function getAqiForPoint(lat, lng) {
  const geohash = toGeohash(lat, lng, 5);
  const key = `aqi:point:${geohash}`;

  let raw = null;
  try {
    raw = await redisGet(key);
  } catch {
    logger.warn("Redis unavailable — falling through to WAQI directly");
  }

  if (raw !== null) {
    logger.debug({ key }, "AQI cache hit");
    const result = JSON.parse(raw);
    result.cached = true;
    return result;
  }

  logger.debug({ key }, "AQI cache miss — calling WAQI");
  const result = await waqi.getAqiByCoordinates(lat, lng);

  try {
    await redisSetex(key, TTL_POINT, JSON.stringify(result));
  } catch {
    logger.warn("Redis write failed — skipping cache write");
  }

  persistAqiHistory(result, lat, lng);

  result.cached = false;
  return result;
}

async function getAqiForBounds(latMin, lngMin, latMax, lngMax) {
  const [sw, ne] = getBoundingBoxGeohashes(latMin, lngMin, latMax, lngMax, 3);
  const key = `aqi:bounds:${sw}:${ne}`;

  let raw = null;
  try {
    raw = await redisGet(key);
  } catch {
    logger.warn("Redis unavailable — falling through to WAQI directly");
  }

  if (raw !== null) {
    logger.debug({ key }, "AQI bounds cache hit");
    const result = JSON.parse(raw);
    return { stations: result, cached: true };
  }

  logger.debug({ key }, "AQI bounds cache miss — calling WAQI");
  const stations = await waqi.getAqiByBounds(latMin, lngMin, latMax, lngMax);

  try {
    await redisSetex(key, TTL_BOUNDS, JSON.stringify(stations));
  } catch {
    logger.warn("Redis write failed — skipping cache write");
  }

  return { stations, cached: false };
}

async function getForecastForPoint(lat, lng) {
  const geohash = toGeohash(lat, lng, 5);
  const key = `aqi:forecast:${geohash}`;

  let raw = null;
  try {
    raw = await redisGet(key);
  } catch {
    logger.warn("Redis unavailable — falling through to WAQI directly");
  }

  if (raw !== null) {
    logger.debug({ key }, "Forecast cache hit");
    const result = JSON.parse(raw);
    result.cached = true;
    return result;
  }

  logger.debug({ key }, "Forecast cache miss — calling WAQI");
  const forecast = await waqi.getForecast(lat, lng);

  try {
    await redisSetex(key, TTL_FORECAST, JSON.stringify(forecast));
  } catch {
    logger.warn("Redis write failed — skipping cache write");
  }

  return { ...forecast, cached: false };
}

async function invalidatePoint(lat, lng) {
  const geohash = toGeohash(lat, lng, 5);
  const key = `aqi:point:${geohash}`;
  try {
    await redisDel(key);
  } catch {
    logger.warn({ key }, "Failed to invalidate cache key");
  }
}

module.exports = {
  getAqiForPoint,
  getAqiForBounds,
  getForecastForPoint,
  invalidatePoint,
};
