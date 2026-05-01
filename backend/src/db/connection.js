const { Pool } = require("pg");
const config = require("../config");
const logger = require("../utils/logger");

const pool = new Pool({ connectionString: config.db.url });

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database pool error");
});

/**
 * Test the database connection and verify PostGIS is available.
 */
async function testConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT PostGIS_Version() AS version");
    logger.info(
      { postgis: result.rows[0].version },
      "Database connected with PostGIS"
    );
  } finally {
    client.release();
  }
}

module.exports = { pool, testConnection };
