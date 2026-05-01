const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const config = require("./config");
const logger = require("./utils/logger");
const { testConnection: testDb } = require("./db/connection");
const { testConnection: testRedis } = require("./db/redis");
const healthRouter = require("./routes/health");
const authRouter = require("./routes/auth");

const app = express();

// ── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

// ── Routes ─────────────────────────────────────────────
app.use(healthRouter);
app.use(authRouter);

// ── 404 handler ────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ──────────────────────────────────────────────
async function start() {
  try {
    await testDb();
    await testRedis();

    app.listen(config.port, () => {
      logger.info({ port: config.port }, "PurePedal backend running");
    });
  } catch (err) {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

start();
