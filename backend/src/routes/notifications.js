const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { syncUser } = require('../middleware/syncUser');
const { pool } = require('../db/connection');
const logger = require('../utils/logger');

router.post('/api/v1/notifications/token', requireAuth, syncUser, async (req, res, next) => {
  try {
    const { token, platform } = req.body;

    if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken[')) {
      return res.status(400).json({ error: 'Invalid token format. Must start with ExponentPushToken[.' });
    }
    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be "ios" or "android".' });
    }

    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW()`,
      [req.dbUser.id, token, platform]
    );

    return res.status(200).json({ message: 'Push token registered successfully.' });
  } catch (err) {
    next(err);
  }
});

router.delete('/api/v1/notifications/token', requireAuth, syncUser, async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required.' });
    }

    await pool.query(
      `DELETE FROM push_tokens WHERE user_id = $1 AND token = $2`,
      [req.dbUser.id, token]
    );

    return res.status(200).json({ message: 'Push token removed successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
