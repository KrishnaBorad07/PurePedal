const { Queue, Worker } = require('bullmq');
const ngeohash = require('ngeohash');
const { pool } = require('../db/connection');
const { redis } = require('../db/redis');
const logger = require('../utils/logger');
const aqiCache = require('../services/aqiCache');
const pushClient = require('../utils/pushClient');
const config = require('../config');
const { createWorkerConnection } = require('./connections');

const QUEUE_NAME = 'hazard-alerts';

function getHazardCategory(aqi) {
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

async function processor(job) {
  const start = Date.now();

  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       ST_Y(u.home_location::geometry) AS lat,
       ST_X(u.home_location::geometry) AS lng,
       pt.token,
       pt.platform
     FROM users u
     LEFT JOIN push_tokens pt ON pt.user_id = u.id
     WHERE u.home_location IS NOT NULL`
  );

  // Group rows by user, deduplicate AQI lookups by geohash5
  const userMap = new Map();
  const aqiByGeohash = new Map();

  for (const row of rows) {
    if (!userMap.has(row.user_id)) {
      userMap.set(row.user_id, { lat: row.lat, lng: row.lng, tokens: [] });
    }
    if (row.token) {
      userMap.get(row.user_id).tokens.push({ token: row.token, platform: row.platform });
    }
    const gh = ngeohash.encode(row.lat, row.lng, 5);
    if (!aqiByGeohash.has(gh)) {
      aqiByGeohash.set(gh, { lat: row.lat, lng: row.lng });
    }
  }

  // Fetch AQI once per unique geohash5
  const aqiResults = new Map();
  for (const [gh, { lat, lng }] of aqiByGeohash) {
    try {
      const result = await aqiCache.getAqiForPoint(lat, lng);
      aqiResults.set(gh, result.aqi);
    } catch (err) {
      logger.error({ err, geohash5: gh }, 'hazard-alerts: failed to fetch AQI for region');
    }
  }

  let usersChecked = 0;
  let alertsSent = 0;
  let suppressed = 0;

  for (const [userId, { lat, lng, tokens }] of userMap) {
    usersChecked++;

    const gh = ngeohash.encode(lat, lng, 5);
    const aqi = aqiResults.get(gh);
    if (aqi == null || aqi <= 100) continue;
    if (tokens.length === 0) continue;

    const suppressionKey = `alert:hazard:${userId}`;
    const isSuppressed = await redis.exists(suppressionKey);
    if (isSuppressed) {
      suppressed++;
      continue;
    }

    const category = getHazardCategory(aqi);
    const notifications = tokens.map(({ token }) => ({
      to: token,
      title: 'Air Quality Alert 🚨',
      body: `AQI at your home location is ${aqi} (${category}). Consider postponing your ride.`,
      data: { type: 'hazard-alert', aqi, category },
      sound: 'default',
      priority: 'high',
    }));

    await pushClient.sendPushNotifications(notifications);
    await redis.set(suppressionKey, '1', 'EX', config.workers.hazardAlertSuppressionTtlS);
    alertsSent++;
  }

  logger.info(
    { jobId: job.id, usersChecked, alertsSent, suppressed, duration_ms: Date.now() - start },
    'hazard-alerts: job complete'
  );
}

async function startHazardAlertsWorker() {
  const queueConn = createWorkerConnection();
  const workerConn = createWorkerConnection();

  const queue = new Queue(QUEUE_NAME, { connection: queueConn });

  await queue.add('check', {}, {
    repeat: { every: config.workers.hazardAlertsIntervalMs },
    attempts: 2,
    backoff: { type: 'fixed', delay: 120000 },
  });

  const hazardAlertsWorker = new Worker(QUEUE_NAME, processor, { connection: workerConn });

  hazardAlertsWorker.on('completed', (job) =>
    logger.info({ queue: QUEUE_NAME, jobId: job.id }, 'Job completed')
  );
  hazardAlertsWorker.on('failed', (job, err) =>
    logger.error({ queue: QUEUE_NAME, jobId: job?.id, err }, 'Job failed')
  );
  hazardAlertsWorker.on('stalled', (jobId) =>
    logger.warn({ queue: QUEUE_NAME, jobId }, 'Job stalled')
  );

  logger.info('hazard-alerts worker started');
  return hazardAlertsWorker;
}

module.exports = { startHazardAlertsWorker };

