const logger = require('../utils/logger');
const { startAqiRefreshWorker } = require('./aqiRefresh');
const { startHazardAlertsWorker } = require('./hazardAlerts');
const { startWeeklySummaryWorker } = require('./weeklySummary');
const { startMonthlyReportWorker } = require('./monthlyReport');

async function startWorkers() {
  const aqiWorker = await startAqiRefreshWorker();
  const hazardWorker = await startHazardAlertsWorker();
  const summaryWorker = await startWeeklySummaryWorker();
  const monthlyWorker = await startMonthlyReportWorker();

  logger.info('All BullMQ workers registered');

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([aqiWorker.close(), hazardWorker.close(), summaryWorker.close(), monthlyWorker.close()]);
    logger.info('All workers closed');
    process.exit(0);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { startWorkers };
