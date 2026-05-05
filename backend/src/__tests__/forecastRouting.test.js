jest.mock("../utils/supabase", () => ({
  adminClient: { auth: { getUser: jest.fn() } },
}));
jest.mock("../db/connection", () => ({ pool: { query: jest.fn() } }));
jest.mock("../db/redis", () => ({ redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock("../services/ors");
jest.mock("../services/scoringClient");
jest.mock("../services/aqiCache");
jest.mock("../utils/logger", () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const { redis } = require("../db/redis");
const scoringClient = require("../services/scoringClient");
const routesRouter = require("../routes/routes");

const app = express();
app.use(express.json());
app.use(routesRouter);

const FREE_USER = {
  id: "free-user-uuid",
  email: "free@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "free",
  subscription_expires_at: null,
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
  created_at: new Date().toISOString(),
};

const PREMIUM_USER = {
  ...FREE_USER,
  id: "premium-user-uuid",
  subscription_status: "premium",
  subscription_expires_at: null,
};

const ORIGIN = { lat: 19.076, lng: 72.877 };
const DESTINATION = { lat: 19.113, lng: 72.869 };

const SCORED_RESPONSE = {
  routes: [{
    id: "ors:0", rank: 1,
    geometry: { type: "LineString", coordinates: [[72.877, 19.076]] },
    distance_m: 5200, duration_s: 1080, elevation_gain_m: 10, instructions: [],
    score: { final: 80, aqi: 85, distance: 78, elevation: 90, avgAqi: 30, maxAqi: 45 },
  }],
};

function authAs(user) {
  adminClient.auth.getUser.mockResolvedValue({
    data: { user: { id: user.id, email: user.email } },
    error: null,
  });
  pool.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [user] });
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue("OK");
  scoringClient.scoreRoutes.mockResolvedValue(SCORED_RESPONSE);

  const ors = require("../services/ors");
  ors.getCyclingRoutes = jest.fn().mockResolvedValue([{
    id: "ors:0",
    geometry: { type: "LineString", coordinates: [[72.877, 19.076], [72.869, 19.113]] },
    distance_m: 5200, duration_s: 1080, elevation_gain_m: 10, instructions: [],
  }]);
});

const validFuture = () => new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6h from now
const pastTs = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
const tooFarTs = () => new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(); // 50h from now

describe("POST /api/v1/routes/suggest — forecastAt param", () => {
  it("returns 400 when forecastAt is in the past (premium user)", async () => {
    authAs(PREMIUM_USER);

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer token")
      .send({ origin: ORIGIN, destination: DESTINATION, forecastAt: pastTs() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/48 hours/i);
  });

  it("returns 400 when forecastAt is more than 48 hours ahead (premium user)", async () => {
    authAs(PREMIUM_USER);

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer token")
      .send({ origin: ORIGIN, destination: DESTINATION, forecastAt: tooFarTs() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/48 hours/i);
  });

  it("silently ignores forecastAt for free-tier users and returns 200", async () => {
    authAs(FREE_USER);

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer token")
      .send({ origin: ORIGIN, destination: DESTINATION, forecastAt: validFuture() });

    expect(res.status).toBe(200);
    expect(res.body.isForecast).toBe(false);
    expect(res.body.forecastAt).toBeNull();
    const [routes, weights, userId, forecastDate] = scoringClient.scoreRoutes.mock.calls[0];
    expect(forecastDate).toBeNull();
  });

  it("forwards forecastDate to scoring service for premium user with valid forecastAt", async () => {
    authAs(PREMIUM_USER);
    const future = validFuture();

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer token")
      .send({ origin: ORIGIN, destination: DESTINATION, forecastAt: future });

    expect(res.status).toBe(200);
    expect(res.body.isForecast).toBe(true);
    expect(res.body.forecastAt).toBe(future);
    const [, , , forecastDate] = scoringClient.scoreRoutes.mock.calls[0];
    expect(forecastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
