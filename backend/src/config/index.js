require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  db: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  scoring: {
    url: process.env.SCORING_SERVICE_URL || "http://localhost:8000",
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  waqi: {
    token: process.env.WAQI_API_TOKEN,
  },
  ors: {
    key: process.env.ORS_API_KEY,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
};
