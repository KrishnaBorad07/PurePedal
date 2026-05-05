const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const { requirePremium } = require("../middleware/requirePremium");
const {
  createRide,
  getRides,
  getRideById,
  getWeeklySummary,
  getBestTime,
  getMonthlyReport,
} = require("../controllers/rides.controller");

// Static routes before /:id to prevent param shadowing
router.get("/api/v1/rides/summary/monthly", requireAuth, syncUser, requirePremium, getMonthlyReport);
router.get("/api/v1/rides/summary/weekly", requireAuth, syncUser, getWeeklySummary);
router.get("/api/v1/rides/best-time", requireAuth, syncUser, getBestTime);
router.get("/api/v1/rides/:id", requireAuth, syncUser, getRideById);
router.post("/api/v1/rides", requireAuth, syncUser, createRide);
router.get("/api/v1/rides", requireAuth, syncUser, getRides);

module.exports = router;
