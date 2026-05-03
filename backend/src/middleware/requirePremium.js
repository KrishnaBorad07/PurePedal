function requirePremium(req, res, next) {
  if (!req.dbUser) {
    throw new Error("requirePremium must be called after syncUser");
  }

  const isPremium =
    req.dbUser.subscription_status === "premium" &&
    (req.dbUser.subscription_expires_at === null ||
      new Date(req.dbUser.subscription_expires_at) > new Date());

  if (!isPremium) {
    return res.status(403).json({
      error: "This feature requires a PurePedal Premium subscription.",
      upgradeRequired: true,
    });
  }

  next();
}

module.exports = { requirePremium };
