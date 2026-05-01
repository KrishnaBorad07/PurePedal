const { adminClient } = require("../utils/supabase");

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header required." });
  }

  if (!authHeader.startsWith("Bearer ") || authHeader.length <= 7) {
    return res.status(401).json({ error: "Malformed authorization header." });
  }

  const token = authHeader.slice(7);

  try {
    const { data, error } = await adminClient.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid token." });
    }

    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
