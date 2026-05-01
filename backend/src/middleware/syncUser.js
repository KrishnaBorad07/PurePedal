const { pool } = require("../db/connection");
const logger = require("../utils/logger");

async function syncUser(req, res, next) {
  try {
    await pool.query(
      `INSERT INTO users (id, email, subscription_status, scoring_weights)
       VALUES ($1, $2, 'free', '{"aqi":0.6,"distance":0.25,"elevation":0.15}')
       ON CONFLICT (id) DO NOTHING`,
      [req.user.id, req.user.email]
    );

    const result = await pool.query(
      `SELECT id, email, display_name,
              ST_AsGeoJSON(home_location) AS home_location,
              subscription_status, subscription_expires_at,
              scoring_weights, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    const user = result.rows[0];
    if (user.home_location) {
      user.home_location = JSON.parse(user.home_location);
    }

    req.dbUser = user;
    next();
  } catch (err) {
    logger.error({ err }, "syncUser failed");
    res.status(500).json({ error: "Internal server error." });
  }
}

module.exports = { syncUser };
