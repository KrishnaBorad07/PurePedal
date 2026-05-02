const { Queue, Worker } = require("bullmq");
const { redis } = require("../db/redis");
const { pool } = require("../db/connection");
const logger = require("../utils/logger");
const aqiCache = require("../services/aqiCache");

const QUEUE_NAME = "aqi-refresh";
const REPEAT_INTERVAL_MS = 25 * 60 * 1000;

async function processor() {
  const { rows } = await pool.query(
    `SELECT
       ST_X(home_location::geometry) AS lng,
       ST_Y(home_location::geometry) AS lat
     FROM users
     WHERE home_location IS NOT NULL`
  );

  logger.info({ count: rows.length }, "aqi-refresh: refreshing regions");

  let refreshed = 0;
  for (const { lat, lng } of rows) {
    try {
      await aqiCache.invalidatePoint(lat, lng);
      await aqiCache.getAqiForPoint(lat, lng);
      refreshed++;
      logger.debug({ lat, lng }, "aqi-refresh: region refreshed");
    } catch (err) {
      logger.error({ err, lat, lng }, "aqi-refresh: failed to refresh region");
    }
  }

  logger.info({ refreshed, total: rows.length }, "aqi-refresh: job complete");
}

async function startAqiRefreshWorker() {
  const queue = new Queue(QUEUE_NAME, { connection: redis });

  await queue.add("refresh", {}, { repeat: { every: REPEAT_INTERVAL_MS } });

  const worker = new Worker(QUEUE_NAME, processor, { connection: redis });

  worker.on("completed", () => logger.info("aqi-refresh: job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ err }, "aqi-refresh: job failed")
  );

  logger.info("aqi-refresh worker started");
}

module.exports = { startAqiRefreshWorker };
