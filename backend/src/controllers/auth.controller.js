const { anonClient, adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const logger = require("../utils/logger");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function signup(req, res) {
  const { email, password } = req.body;

  if (!email || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: "Valid email is required." });
  }
  if (!password || password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters." });
  }

  try {
    const { error } = await anonClient.auth.signUp({ email, password });

    if (error) {
      if (
        error.message &&
        error.message.toLowerCase().includes("already registered")
      ) {
        return res
          .status(400)
          .json({ error: "An account with this email already exists." });
      }
      //   logger.error({ err: error }, "Signup failed");
      //   return res
      //     .status(500)
      //     .json({ error: "Signup service unavailable. Please try again later." });
      return res.status(500).json({
        error: error.message || "Signup failed",
      });
    }

    res.status(201).json({
      message: "Signup successful. Check your email to confirm your account.",
    });
  } catch (err) {
    logger.error({ err }, "Signup unexpected error");
    res
      .status(500)
      .json({ error: "Signup service unavailable. Please try again later." });
  }
}

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (
        error.message &&
        error.message.toLowerCase().includes("invalid login credentials")
      ) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
      logger.error({ err: error }, "Login failed");
      return res
        .status(500)
        .json({ error: "Login service unavailable. Please try again later." });
    }

    res.status(200).json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: 3600,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (err) {
    logger.error({ err }, "Login unexpected error");
    res
      .status(500)
      .json({ error: "Login service unavailable. Please try again later." });
  }
}

async function logout(req, res) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(400).json({
        success: false,
        error: "Authorization token missing or invalid format",
      });
    }

    const token = authHeader.split(" ")[1];
    logger.info({ token }, "User logged out");

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    logger.error({ err }, "Logout unexpected error");
    return res.status(500).json({
      success: false,
      error: "Logout failed. Please try again later.",
    });
  }
}

function getMe(req, res) {
  res.status(200).json(req.dbUser);
}

async function patchMe(req, res) {
  const { display_name, home_location } = req.body;

  if (display_name !== undefined) {
    if (typeof display_name !== "string" || display_name.length > 50) {
      return res
        .status(400)
        .json({ error: "display_name must be 50 characters or fewer." });
    }
  }

  if (home_location !== undefined) {
    const { lat, lng } = home_location || {};
    if (typeof lat !== "number" || lat < -90 || lat > 90) {
      return res
        .status(400)
        .json({ error: "home_location.lat must be between -90 and 90." });
    }
    if (typeof lng !== "number" || lng < -180 || lng > 180) {
      return res
        .status(400)
        .json({ error: "home_location.lng must be between -180 and 180." });
    }
  }

  const updates = [];
  const params = [];
  let i = 1;

  if (display_name !== undefined) {
    updates.push(`display_name = $${i++}`);
    params.push(display_name);
  }

  if (home_location !== undefined) {
    updates.push(
      `home_location = ST_SetSRID(ST_MakePoint($${i++}, $${i++}), 4326)`,
    );
    params.push(home_location.lng, home_location.lat);
  }

  if (updates.length === 0) {
    return res.status(200).json(req.dbUser);
  }

  updates.push(`updated_at = NOW()`);
  params.push(req.user.id);

  try {
    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $${i}
       RETURNING id, email, display_name,
                 ST_AsGeoJSON(home_location) AS home_location,
                 subscription_status, subscription_expires_at,
                 scoring_weights, created_at`,
      params,
    );

    const user = result.rows[0];
    if (user.home_location) {
      user.home_location = JSON.parse(user.home_location);
    }

    res.status(200).json(user);
  } catch (err) {
    logger.error({ err }, "PATCH /me failed");
    res.status(500).json({ error: "Internal server error." });
  }
}

function getSubscriptionStatus(req, res) {
  const { subscription_status, subscription_expires_at } = req.dbUser;

  const isActive =
    subscription_status === "premium" &&
    (subscription_expires_at === null ||
      new Date(subscription_expires_at) > new Date());

  return res.status(200).json({
    status: subscription_status,
    expiresAt: subscription_expires_at ?? null,
    isActive,
    canAccessPremium: isActive,
  });
}

async function patchScoringWeights(req, res, next) {
  try {
    const { aqi, distance, elevation } = req.body;

    if (aqi === undefined || distance === undefined || elevation === undefined) {
      return res.status(400).json({ error: "aqi, distance, and elevation are all required." });
    }
    if (typeof aqi !== "number" || typeof distance !== "number" || typeof elevation !== "number") {
      return res.status(400).json({ error: "aqi, distance, and elevation must be numbers." });
    }
    if (aqi < 0 || aqi > 1 || distance < 0 || distance > 1 || elevation < 0 || elevation > 1) {
      return res.status(400).json({ error: "Each weight must be between 0.0 and 1.0." });
    }

    const sum = aqi + distance + elevation;
    if (Math.abs(sum - 1.0) > 0.01) {
      return res.status(400).json({
        error: `Weights must sum to 1.0. Received sum: ${sum.toFixed(2)}`,
      });
    }

    const { rows } = await pool.query(
      "UPDATE users SET scoring_weights = $1, updated_at = NOW() WHERE id = $2 RETURNING scoring_weights",
      [{ aqi, distance, elevation }, req.dbUser.id]
    );

    return res.json({
      scoringWeights: rows[0].scoring_weights,
      message: "Scoring weights updated successfully.",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login, logout, getMe, patchMe, getSubscriptionStatus, patchScoringWeights };