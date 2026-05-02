const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const { requirePremium } = require("../middleware/requirePremium");
const { getCurrentAqi, getHeatmap, getForecast } = require("../controllers/aqi.controller");

const router = express.Router();

router.get("/api/v1/aqi/current", requireAuth, syncUser, getCurrentAqi);
router.get("/api/v1/aqi/heatmap", requireAuth, syncUser, getHeatmap);
router.get("/api/v1/aqi/forecast", requireAuth, syncUser, requirePremium, getForecast);

module.exports = router;
