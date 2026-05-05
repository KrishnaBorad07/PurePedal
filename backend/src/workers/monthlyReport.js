const { Queue, Worker } = require("bullmq");
const { pool } = require("../db/connection");
const { adminClient } = require("../utils/supabase");
const logger = require("../utils/logger");
const config = require("../config");
const { createWorkerConnection } = require("./connections");
const { getMonthlyReportData } = require("../services/reportData");
const { generateMonthlyReport } = require("../utils/reportGenerator");

const QUEUE_NAME = "monthly-report";
const STORAGE_BUCKET = "monthly-reports";

function getPreviousMonth() {
  const now = new Date();
  let month = now.getUTCMonth(); // 0-based, so this is already "previous month" in 1-based
  let year = now.getUTCFullYear();
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return { month, year };
}

async function processor(job) {
  const start = Date.now();
  const { month, year } = getPreviousMonth();

  logger.info({ jobId: job.id, month, year }, "monthly-report: starting");

  const { rows: premiumUsers } = await pool.query(
    `SELECT id FROM users
     WHERE subscription_status = 'premium'
       AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())`
  );

  let reportsGenerated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { id: userId } of premiumUsers) {
    try {
      const data = await getMonthlyReportData(userId, month, year);
      if (!data) {
        logger.info({ userId, month, year }, "monthly-report: no rides, skipping");
        skipped++;
        continue;
      }

      const pdfBuffer = await generateMonthlyReport(userId, month, year, data);
      const monthPadded = String(month).padStart(2, "0");
      const filePath = `${userId}/${year}-${monthPadded}-report.pdf`;

      const { error: uploadError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      await pool.query(
        `INSERT INTO report_metadata (user_id, month, year, file_path)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, month, year) DO UPDATE SET file_path = $4, generated_at = NOW()`,
        [userId, month, year, filePath]
      );

      logger.info({ userId, month, year, filePath }, "monthly-report: report generated");
      reportsGenerated++;
    } catch (err) {
      logger.error({ err, userId, month, year }, "monthly-report: failed for user");
      errors++;
    }
  }

  logger.info(
    { jobId: job.id, usersProcessed: premiumUsers.length, reportsGenerated, skipped, errors, duration_ms: Date.now() - start },
    "monthly-report: job complete"
  );
}

async function startMonthlyReportWorker() {
  const queueConn = createWorkerConnection();
  const workerConn = createWorkerConnection();

  const queue = new Queue(QUEUE_NAME, { connection: queueConn });

  await queue.add("generate", {}, {
    repeat: { cron: config.workers.monthlyReportCron },
    attempts: 3,
    backoff: { type: "exponential", delay: 300_000 },
  });

  const worker = new Worker(QUEUE_NAME, processor, { connection: workerConn });

  worker.on("completed", (job) =>
    logger.info({ queue: QUEUE_NAME, jobId: job.id }, "Job completed")
  );
  worker.on("failed", (job, err) =>
    logger.error({ queue: QUEUE_NAME, jobId: job?.id, err }, "Job failed")
  );
  worker.on("stalled", (jobId) =>
    logger.warn({ queue: QUEUE_NAME, jobId }, "Job stalled")
  );

  logger.info("monthly-report worker started");
  return worker;
}

module.exports = { startMonthlyReportWorker };
