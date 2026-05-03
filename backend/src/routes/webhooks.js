const express = require("express");
const { pool } = require("../db/connection");
const logger = require("../utils/logger");
const { verifyRevenueCat } = require("../middleware/verifyRevenueCat");

const router = express.Router();

const UPGRADE_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"]);
const LAPSE_EVENTS = new Set(["EXPIRATION", "BILLING_ISSUE"]);

async function revenueCatWebhookHandler(req, res) {
  const { event } = req.body || {};

  if (!event || !event.type || !event.app_user_id) {
    return res.status(400).json({ error: "Malformed webhook payload." });
  }

  const { type, app_user_id, expiration_at_ms } = event;

  let userId = null;

  try {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [app_user_id],
    );

    if (userResult.rows.length === 0) {
      logger.warn({ app_user_id, eventType: type }, "RevenueCat webhook: user not found");
    } else {
      userId = userResult.rows[0].id;

      if (UPGRADE_EVENTS.has(type)) {
        const expiresAt = expiration_at_ms
          ? new Date(expiration_at_ms).toISOString()
          : null;
        await pool.query(
          `UPDATE users
           SET subscription_status = 'premium',
               subscription_expires_at = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [expiresAt, userId],
        );
        logger.info({ userId, eventType: type, expiresAt }, "Subscription upgraded");
      } else if (LAPSE_EVENTS.has(type)) {
        await pool.query(
          `UPDATE users
           SET subscription_status = 'lapsed',
               subscription_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [userId],
        );
        logger.info({ userId, eventType: type }, "Subscription lapsed");
      } else if (type === "CANCELLATION") {
        logger.info({ userId, eventType: type }, "Subscription cancelled — access retained until expiry");
      } else {
        logger.info({ userId, eventType: type }, "RevenueCat webhook: unhandled event type, no action");
      }
    }

    await pool.query(
      `INSERT INTO subscription_events (user_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, type, JSON.stringify(event)],
    );
  } catch (err) {
    logger.error({ err, app_user_id, eventType: type }, "RevenueCat webhook processing error");
  }

  return res.status(200).json({ received: true });
}

router.post(
  "/revenuecat",
  verifyRevenueCat,
  express.json(),
  revenueCatWebhookHandler,
);

module.exports = router;
