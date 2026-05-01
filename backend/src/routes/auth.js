const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const {
  signup,
  login,
  logout,
  getMe,
  patchMe,
} = require("../controllers/auth.controller");

const router = express.Router();

function makeRateLimiter(max, windowMs) {
  return rateLimit({
    windowMs,
    max,
    message: { error: "Too many requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// const signupLimiter = makeRateLimiter(5, 60 * 60 * 1000);
// const loginLimiter = makeRateLimiter(10, 15 * 60 * 1000);

const signupLimiter = makeRateLimiter(1000000, 60 * 60 * 1000);
const loginLimiter = makeRateLimiter(1000000, 60 * 60 * 1000);
const logoutLimiter = makeRateLimiter(10, 60 * 1000);
const getMeLimiter = makeRateLimiter(60, 60 * 1000);
const patchMeLimiter = makeRateLimiter(20, 60 * 1000);

router.post("/api/v1/auth/signup", signupLimiter, signup);
router.post("/api/v1/auth/login", loginLimiter, login);
router.post("/api/v1/auth/logout", logoutLimiter, requireAuth, logout);
router.get("/api/v1/me", getMeLimiter, requireAuth, syncUser, getMe);
router.patch("/api/v1/me", patchMeLimiter, requireAuth, syncUser, patchMe);

module.exports = router;
