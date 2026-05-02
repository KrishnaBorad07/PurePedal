const { redis } = require("../db/redis");
const ors = require("./ors");
const { toGeohash } = require("../utils/geo");
const logger = require("../utils/logger");

const ROUTE_TTL = 3600;

function cacheKey(origin, destination) {
  const originGH = toGeohash(origin.lat, origin.lng, 6);
  const destGH = toGeohash(destination.lat, destination.lng, 6);
  return `route:${originGH}:${destGH}`;
}

async function getRoutes(origin, destination) {
  const key = cacheKey(origin, destination);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return { routes: JSON.parse(cached), cached: true };
    }
  } catch (err) {
    logger.warn({ err }, "Redis unavailable — falling through to ORS directly");
    const routes = await ors.getCyclingRoutes(origin, destination);
    return { routes, cached: false };
  }

  const routes = await ors.getCyclingRoutes(origin, destination);

  redis
    .set(key, JSON.stringify(routes), "EX", ROUTE_TTL)
    .catch((err) => logger.warn({ err }, "Failed to cache routes in Redis"));

  return { routes, cached: false };
}

async function invalidateRoutes(origin, destination) {
  const key = cacheKey(origin, destination);
  await redis.del(key);
}

module.exports = { getRoutes, invalidateRoutes };
