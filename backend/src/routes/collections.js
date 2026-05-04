const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { syncUser } = require("../middleware/syncUser");
const { requirePremium } = require("../middleware/requirePremium");
const {
  createCollection,
  getCollections,
  renameCollection,
  deleteCollection,
} = require("../controllers/collections.controller");

const router = express.Router();
const BASE = "/api/v1/collections";

router.post(BASE, requireAuth, syncUser, requirePremium, createCollection);
router.get(BASE, requireAuth, syncUser, requirePremium, getCollections);
router.patch(`${BASE}/:id`, requireAuth, syncUser, requirePremium, renameCollection);
router.delete(`${BASE}/:id`, requireAuth, syncUser, requirePremium, deleteCollection);

module.exports = router;
