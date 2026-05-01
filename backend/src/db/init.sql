-- PurePedal database initialization
-- Runs automatically on first docker-compose up

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    home_location   GEOGRAPHY(POINT, 4326),

    -- Subscription
    subscription_status     TEXT NOT NULL DEFAULT 'free'
        CHECK (subscription_status IN ('free', 'premium', 'lapsed')),
    subscription_expires_at TIMESTAMPTZ,

    -- Premium: custom scoring weights
    scoring_weights JSONB DEFAULT '{"aqi": 0.6, "distance": 0.25, "elevation": 0.15}'::jsonb,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Route collections (premium) ────────────────────────
CREATE TABLE IF NOT EXISTS collections (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Saved routes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_routes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT 'Untitled route',
    geometry        GEOGRAPHY(LINESTRING, 4326) NOT NULL,
    distance_m      INTEGER NOT NULL,
    elevation_gain_m INTEGER DEFAULT 0,
    aqi_at_save     NUMERIC,
    tags            TEXT[] DEFAULT '{}',
    collection_id   UUID REFERENCES collections(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saved_routes_user ON saved_routes(user_id);

-- ── Rides ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_route_id  UUID REFERENCES saved_routes(id) ON DELETE SET NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    track_geometry  GEOGRAPHY(LINESTRING, 4326),
    distance_m      INTEGER,
    duration_seconds INTEGER,
    avg_aqi         NUMERIC,
    max_aqi         NUMERIC,
    aqi_samples     JSONB DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rides_user ON rides(user_id);
CREATE INDEX idx_rides_started ON rides(started_at DESC);

-- ── AQI history (for exposure tracking) ────────────────
CREATE TABLE IF NOT EXISTS aqi_history (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    aqi_value   NUMERIC NOT NULL,
    pollutant   TEXT,
    source      TEXT DEFAULT 'waqi',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aqi_history_location ON aqi_history USING GIST(location);
CREATE INDEX idx_aqi_history_time ON aqi_history(recorded_at DESC);

-- ── Push tokens ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, token)
);

-- ── Subscription events (audit log) ────────────────────
CREATE TABLE IF NOT EXISTS subscription_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Updated-at trigger ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
