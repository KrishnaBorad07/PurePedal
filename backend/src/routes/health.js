const express = require("express");
const { pool } = require("../db/connection");
const { redis } = require("../db/redis");
const config = require("../config");
const logger = require("../utils/logger");

const router = express.Router();

router.get("/health", async (req, res) => {
  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "purepedal-backend",
    dependencies: {},
  };

  // Postgres
  try {
    const result = await pool.query("SELECT 1 AS alive");
    checks.dependencies.postgres = { status: "ok" };
  } catch (err) {
    checks.dependencies.postgres = { status: "error", message: err.message };
    checks.status = "degraded";
  }

  // Redis
  try {
    const pong = await redis.ping();
    checks.dependencies.redis = { status: "ok" };
  } catch (err) {
    checks.dependencies.redis = { status: "error", message: err.message };
    checks.status = "degraded";
  }

  // Scoring service
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${config.scoring.url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      checks.dependencies.scoring = { status: "ok" };
    } else {
      checks.dependencies.scoring = {
        status: "error",
        message: `HTTP ${resp.status}`,
      };
      checks.status = "degraded";
    }
  } catch (err) {
    checks.dependencies.scoring = { status: "error", message: err.message };
    checks.status = "degraded";
  }

  const httpStatus = checks.status === "ok" ? 200 : 503;
  res.status(httpStatus).json(checks);
});

module.exports = router;
