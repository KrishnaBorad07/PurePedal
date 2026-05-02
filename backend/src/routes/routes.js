const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const {
  suggestRoutes,
  getSavedRoutes,
  saveRoute,
  deleteRoute,
} = require("../controllers/routes.controller");

const router = express.Router();

router.post("/api/v1/routes/suggest", requireAuth, syncUser, suggestRoutes);
router.get("/api/v1/routes/saved", requireAuth, syncUser, getSavedRoutes);
router.post("/api/v1/routes/saved", requireAuth, syncUser, saveRoute);
router.delete("/api/v1/routes/saved/:id", requireAuth, syncUser, deleteRoute);

module.exports = router;
