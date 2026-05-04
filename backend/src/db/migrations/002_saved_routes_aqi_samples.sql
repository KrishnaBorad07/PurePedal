ALTER TABLE saved_routes
  ADD COLUMN IF NOT EXISTS aqi_samples    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT NULL;
