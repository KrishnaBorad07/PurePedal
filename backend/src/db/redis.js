const Redis = require("ioredis");
const config = require("../config");
const logger = require("../utils/logger");

const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error({ err }, "Redis error"));

/**
 * Test the Redis connection.
 */
async function testConnection() {
  await redis.connect();
  const pong = await redis.ping();
  logger.info({ pong }, "Redis ping successful");
}

module.exports = { redis, testConnection };
