const { pool } = require("../db/connection");

const MAX_COLLECTIONS = 20;

async function createCollection(req, res, next) {
  try {
    const { name } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required." });
    }
    if (name.length > 50) {
      return res.status(400).json({ error: "name must be 50 characters or fewer." });
    }

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM collections WHERE user_id = $1",
      [req.dbUser.id]
    );
    if (parseInt(countResult.rows[0].count, 10) >= MAX_COLLECTIONS) {
      return res.status(400).json({ error: "Maximum of 20 collections reached." });
    }

    const result = await pool.query(
      "INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at",
      [req.dbUser.id, name.trim()]
    );

    return res.status(201).json({ ...result.rows[0], routeCount: 0 });
  } catch (err) {
    next(err);
  }
}

async function getCollections(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.created_at, COUNT(sr.id)::int AS route_count
       FROM collections c
       LEFT JOIN saved_routes sr ON sr.collection_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [req.dbUser.id]
    );

    const collections = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      routeCount: row.route_count,
    }));

    return res.json({ collections, count: collections.length });
  } catch (err) {
    next(err);
  }
}

async function renameCollection(req, res, next) {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required." });
    }
    if (name.length > 50) {
      return res.status(400).json({ error: "name must be 50 characters or fewer." });
    }

    const existing = await pool.query(
      "SELECT id, user_id FROM collections WHERE id = $1",
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Collection not found." });
    }
    if (existing.rows[0].user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to modify this collection." });
    }

    const result = await pool.query(
      "UPDATE collections SET name = $1 WHERE id = $2 RETURNING id, name, created_at",
      [name.trim(), id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function deleteCollection(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await pool.query(
      "SELECT id, user_id FROM collections WHERE id = $1",
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Collection not found." });
    }
    if (existing.rows[0].user_id !== req.dbUser.id) {
      return res.status(403).json({ error: "You do not have permission to delete this collection." });
    }

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM saved_routes WHERE collection_id = $1",
      [id]
    );
    const routeCount = parseInt(countResult.rows[0].count, 10);

    await pool.query("DELETE FROM collections WHERE id = $1", [id]);

    return res.json({
      message: `Collection deleted. ${routeCount} route${routeCount === 1 ? "" : "s"} moved to uncollected.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCollection, getCollections, renameCollection, deleteCollection };
