const { Redis } = require('ioredis');
const config = require('../config');

const createWorkerConnection = () =>
  new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

module.exports = { createWorkerConnection };
