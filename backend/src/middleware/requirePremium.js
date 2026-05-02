function requirePremium(req, res, next) {
  if (!req.dbUser) {
    throw new Error("requirePremium must be called after syncUser");
  }
  if (req.dbUser.subscription_status !== "premium") {
    return res
      .status(403)
      .json({ error: "This feature requires a PurePedal Premium subscription." });
  }
  next();
}

module.exports = { requirePremium };
