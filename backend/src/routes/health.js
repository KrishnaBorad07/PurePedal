const express = require("express");
const { getHealth } = require("../controllers/health.controller");

const router = express.Router();

router.get("/api/v1/health", getHealth);

module.exports = router;
