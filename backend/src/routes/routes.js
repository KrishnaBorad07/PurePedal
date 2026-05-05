const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const { requirePremium } = require("../middleware/requirePremium");
const {
  suggestRoutes,
  getSavedRoutes,
  getSavedRoute,
  saveRoute,
  deleteRoute,
  assignRouteCollection,
  getDepartureForecast,
} = require("../controllers/routes.controller");

const router = express.Router();

router.post("/api/v1/routes/suggest", requireAuth, syncUser, suggestRoutes);
router.get("/api/v1/routes/saved", requireAuth, syncUser, getSavedRoutes);
// Specific sub-paths before /:id to prevent shadowing
router.get("/api/v1/routes/saved/:id/departure-forecast", requireAuth, syncUser, requirePremium, getDepartureForecast);
router.get("/api/v1/routes/saved/:id", requireAuth, syncUser, getSavedRoute);
router.post("/api/v1/routes/saved", requireAuth, syncUser, saveRoute);
router.delete("/api/v1/routes/saved/:id", requireAuth, syncUser, deleteRoute);
router.patch("/api/v1/routes/saved/:id/collection", requireAuth, syncUser, requirePremium, assignRouteCollection);

module.exports = router;
