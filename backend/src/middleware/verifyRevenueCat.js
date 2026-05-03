const config = require("../config");

function verifyRevenueCat(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header." });
  }

  const token = authHeader.slice("Bearer ".length);
  if (token !== config.revenuecat.webhookSecret) {
    return res.status(401).json({ error: "Invalid webhook secret." });
  }

  next();
}

module.exports = { verifyRevenueCat };
