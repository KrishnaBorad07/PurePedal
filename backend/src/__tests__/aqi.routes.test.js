jest.mock("../utils/supabase", () => ({
  adminClient: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../services/aqiCache");
jest.mock("../utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const aqiCache = require("../services/aqiCache");
const aqiRouter = require("../routes/aqi");
const { WaqiApiError, StationTooFarError, NoForecastAvailableError } = require("../utils/errors");

const app = express();
app.use(express.json());
app.use(aqiRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

const FREE_USER = {
  id: "user-uuid",
  email: "test@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "free",
  subscription_expires_at: null,
  scoring_weights: {},
  created_at: new Date().toISOString(),
};

const PREMIUM_USER = { ...FREE_USER, subscription_status: "premium" };

const MOCK_READING = {
  aqi: 85,
  station: { id: "waqi:1", name: "Test", lat: 19.076, lng: 72.877 },
  dominantPollutant: "pm25",
  pollutants: { pm25: 42 },
  category: "moderate",
  recordedAt: "2026-04-30T14:00:00Z",
  cached: true,
};

function authAs(user) {
  adminClient.auth.getUser.mockResolvedValue({ data: { user: { id: user.id, email: user.email } }, error: null });
  pool.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [user] });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── GET /current ─────────────────────────────────────────────────────────────

describe("GET /api/v1/aqi/current", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/v1/aqi/current?lat=19.076&lng=72.877");
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing lat/lng", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .get("/api/v1/aqi/current")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 for out-of-range coordinates", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .get("/api/v1/aqi/current?lat=91&lng=0")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 200 with cached reading for valid coordinates", async () => {
    authAs(FREE_USER);
    aqiCache.getAqiForPoint.mockResolvedValue(MOCK_READING);

    const res = await request(app)
      .get("/api/v1/aqi/current?lat=19.076&lng=72.877")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.aqi).toBe(85);
    expect(res.body.cached).toBe(true);
  });

  it("returns 404 when station is too far", async () => {
    authAs(FREE_USER);
    aqiCache.getAqiForPoint.mockRejectedValue(new StationTooFarError("Too far"));

    const res = await request(app)
      .get("/api/v1/aqi/current?lat=0&lng=0")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("returns 502 on WAQI failure", async () => {
    authAs(FREE_USER);
    aqiCache.getAqiForPoint.mockRejectedValue(new WaqiApiError("WAQI down"));

    const res = await request(app)
      .get("/api/v1/aqi/current?lat=19.076&lng=72.877")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(502);
  });
});

// ── GET /heatmap ──────────────────────────────────────────────────────────────

describe("GET /api/v1/aqi/heatmap", () => {
  it("returns 400 for bounding box larger than 2×2 degrees", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .get("/api/v1/aqi/heatmap?latMin=0&lngMin=0&latMax=3&lngMax=3")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("returns 200 with valid bounding box", async () => {
    authAs(FREE_USER);
    aqiCache.getAqiForBounds.mockResolvedValue({
      stations: [MOCK_READING],
      cached: true,
    });

    const res = await request(app)
      .get("/api/v1/aqi/heatmap?latMin=18&lngMin=72&latMax=20&lngMax=74")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.cached).toBe(true);
    expect(res.body.stations[0].pollutants).toBeUndefined();
  });

  it("returns 400 for missing parameters", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .get("/api/v1/aqi/heatmap?latMin=18&lngMin=72")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

// ── GET /forecast ─────────────────────────────────────────────────────────────

describe("GET /api/v1/aqi/forecast", () => {
  it("returns 403 for free-tier user", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .get("/api/v1/aqi/forecast?lat=19.076&lng=72.877")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/premium/i);
  });

  it("returns 200 with forecast for premium user", async () => {
    authAs(PREMIUM_USER);
    aqiCache.getForecastForPoint.mockResolvedValue({
      daily: {
        pm25: [
          { day: "2026-04-30", avg: 72, min: 50, max: 90 },
          { day: "2026-05-01", avg: 68, min: 45, max: 85 },
        ],
      },
      cached: true,
    });

    const res = await request(app)
      .get("/api/v1/aqi/forecast?lat=19.076&lng=72.877&hours=2")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.forecast).toHaveLength(2);
    expect(res.body.hoursReturned).toBe(2);
    expect(res.body.cached).toBe(true);
  });

  it("returns 404 when no forecast is available", async () => {
    authAs(PREMIUM_USER);
    aqiCache.getForecastForPoint.mockRejectedValue(
      new NoForecastAvailableError("No forecast")
    );

    const res = await request(app)
      .get("/api/v1/aqi/forecast?lat=19.076&lng=72.877")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});
