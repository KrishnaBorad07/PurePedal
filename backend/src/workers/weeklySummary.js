const { Queue, Worker } = require('bullmq');
const { pool } = require('../db/connection');
const { redis } = require('../db/redis');
const logger = require('../utils/logger');
const { getCurrentWeekBounds } = require('../utils/geo');
const config = require('../config');
const { createWorkerConnection } = require('./connections');

const QUEUE_NAME = 'weekly-summary';

function getCategory(aqi) {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy-for-sensitive-groups';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

async function processor(job) {
  const start = Date.now();
  const { weekStart, weekEnd } = getCurrentWeekBounds();

  const { rows: activeUsers } = await pool.query(
    `SELECT DISTINCT user_id FROM rides
     WHERE started_at >= $1 AND started_at <= $2`,
    [weekStart, weekEnd]
  );

  let usersProcessed = 0;

  for (const { user_id } of activeUsers) {
    try {
      const [aggResult, cleanestResult, pollutedResult] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS total_rides,
                  SUM(distance_m) AS total_distance_m,
                  SUM(duration_seconds) AS total_duration_seconds,
                  AVG(avg_aqi) AS avg_aqi
           FROM rides
           WHERE user_id = $1 AND started_at >= $2 AND started_at <= $3`,
          [user_id, weekStart, weekEnd]
        ),
        pool.query(
          `SELECT id, started_at, distance_m, avg_aqi
           FROM rides
           WHERE user_id = $1 AND started_at >= $2 AND started_at <= $3
           ORDER BY avg_aqi ASC LIMIT 1`,
          [user_id, weekStart, weekEnd]
        ),
        pool.query(
          `SELECT id, started_at, distance_m, avg_aqi
           FROM rides
           WHERE user_id = $1 AND started_at >= $2 AND started_at <= $3
           ORDER BY avg_aqi DESC LIMIT 1`,
          [user_id, weekStart, weekEnd]
        ),
      ]);

      const agg = aggResult.rows[0];
      const totalRides = parseInt(agg.total_rides);
      const avgAqi = parseFloat(parseFloat(agg.avg_aqi).toFixed(1));
      const cleanest = cleanestResult.rows[0];
      const polluted = pollutedResult.rows[0];

      const summary = {
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
      };

      const cacheKey = `weekly-summary:${user_id}:${weekStart.toISOString().slice(0, 10)}`;
      await redis.set(cacheKey, JSON.stringify(summary), 'EX', config.workers.weeklySummaryTtlS);
      usersProcessed++;
    } catch (err) {
      logger.error({ err, user_id }, 'weekly-summary: failed to process user');
    }
  }

  logger.info({ jobId: job.id, usersProcessed, duration_ms: Date.now() - start }, 'weekly-summary: job complete');
}

async function startWeeklySummaryWorker() {
  const queueConn = createWorkerConnection();
  const workerConn = createWorkerConnection();

  const queue = new Queue(QUEUE_NAME, { connection: queueConn });

  await queue.add('compute', {}, {
    repeat: { cron: config.workers.weeklySummaryCron },
  });

  const weeklySummaryWorker = new Worker(QUEUE_NAME, processor, { connection: workerConn });

  weeklySummaryWorker.on('completed', (job) =>
    logger.info({ queue: QUEUE_NAME, jobId: job.id }, 'Job completed')
  );
  weeklySummaryWorker.on('failed', (job, err) =>
    logger.error({ queue: QUEUE_NAME, jobId: job?.id, err }, 'Job failed')
  );
  weeklySummaryWorker.on('stalled', (jobId) =>
    logger.warn({ queue: QUEUE_NAME, jobId }, 'Job stalled')
  );

  logger.info('weekly-summary worker started');
  return weeklySummaryWorker;
}

module.exports = { startWeeklySummaryWorker };
