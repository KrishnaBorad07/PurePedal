const { Queue, Worker } = require('bullmq');
const ngeohash = require('ngeohash');
const { pool } = require('../db/connection');
const logger = require('../utils/logger');
const aqiCache = require('../services/aqiCache');
const config = require('../config');
const { createWorkerConnection } = require('./connections');

const QUEUE_NAME = 'aqi-refresh';

async function processor(job) {
  const start = Date.now();
  const { rows } = await pool.query(
    `SELECT DISTINCT
       ST_Y(home_location::geometry) AS lat,
       ST_X(home_location::geometry) AS lng
     FROM users
     WHERE home_location IS NOT NULL`
  );

  const seen = new Set();
  const regions = [];
  for (const { lat, lng } of rows) {
    const gh = ngeohash.encode(lat, lng, 5);
    if (!seen.has(gh)) {
      seen.add(gh);
      regions.push({ lat, lng, gh });
    }
  }

  logger.info({ jobId: job.id, regions: regions.length }, 'aqi-refresh: refreshing regions');

  let refreshed = 0;
  for (const { lat, lng, gh } of regions) {
    try {
      await aqiCache.invalidatePoint(lat, lng);
      const result = await aqiCache.getAqiForPoint(lat, lng);
      refreshed++;
      logger.debug({ geohash5: gh, aqi: result.aqi }, 'aqi-refresh: region refreshed');
    } catch (err) {
      logger.error({ err, geohash5: gh }, 'aqi-refresh: failed to refresh region');
    }
  }

  logger.info({ jobId: job.id, regionsRefreshed: refreshed, duration_ms: Date.now() - start }, 'aqi-refresh: job complete');
}

async function startAqiRefreshWorker() {
  const queueConn = createWorkerConnection();
  const workerConn = createWorkerConnection();

  const queue = new Queue(QUEUE_NAME, { connection: queueConn });

  await queue.add('refresh', {}, {
    repeat: { every: config.workers.aqiRefreshIntervalMs },
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  });

  const aqiRefreshWorker = new Worker(QUEUE_NAME, processor, { connection: workerConn });

  aqiRefreshWorker.on('completed', (job) =>
    logger.info({ queue: QUEUE_NAME, jobId: job.id }, 'Job completed')
  );
  aqiRefreshWorker.on('failed', (job, err) =>
    logger.error({ queue: QUEUE_NAME, jobId: job?.id, err }, 'Job failed')
  );
  aqiRefreshWorker.on('stalled', (jobId) =>
    logger.warn({ queue: QUEUE_NAME, jobId }, 'Job stalled')
  );

  logger.info('aqi-refresh worker started');
  return aqiRefreshWorker;
}

module.exports = { startAqiRefreshWorker };
