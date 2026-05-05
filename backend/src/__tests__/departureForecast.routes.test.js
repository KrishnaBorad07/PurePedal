jest.mock("../utils/supabase", () => ({
  adminClient: { auth: { getUser: jest.fn() } },
}));
jest.mock("../db/connection", () => ({ pool: { query: jest.fn() } }));
jest.mock("../db/redis", () => ({ redis: { get: jest.fn(), set: jest.fn() } }));
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
const aqiCache = require("../services/aqiCache");
const routesRouter = require("../routes/routes");

const app = express();
app.use(express.json());
app.use(routesRouter);

const FREE_USER = {
  id: "free-uuid",
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
  id: "premium-uuid",
  subscription_status: "premium",
};

const OTHER_USER_ID = "other-user-uuid";
const ROUTE_ID = "route-uuid-1234";

const MOCK_ROUTE_ROW = {
  id: ROUTE_ID,
  user_id: PREMIUM_USER.id,
  name: "Morning commute",
  origin_lat: 19.076,
  origin_lng: 72.877,
};

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const MOCK_FORECAST = {
  forecast: [
    { day: today, avg: 45, min: 30, max: 65 },
    { day: tomorrow, avg: 60, min: 40, max: 80 },
  ],
  cached: true,
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
});

describe("GET /api/v1/routes/saved/:id/departure-forecast", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for free-tier user", async () => {
    authAs(FREE_USER);

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("returns 404 for non-existent route", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [] }); // no route found

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 403 for another user's route", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ ...MOCK_ROUTE_ROW, user_id: OTHER_USER_ID }] });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when no forecast data is available", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
    expect(res.body.cached).toBe(false);
  });

  it("returns 200 with forecast windows for a valid request", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue(MOCK_FORECAST);

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.routeId).toBe(ROUTE_ID);
    expect(res.body.forecastDays).toHaveLength(2);
    expect(res.body.daysReturned).toBe(2);
    expect(res.body.cached).toBe(true);

    const day = res.body.forecastDays[0];
    expect(day.windows).toHaveLength(3);
    expect(day.bestWindow).toBeDefined();
    expect(day.overallRating).toBeDefined();
  });

  it("assigns 'excellent' rating for AQI 0–50", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue({
      forecast: [{ day: today, avg: 45, min: 30, max: 65 }],
      cached: false,
    });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    const morningWindow = res.body.forecastDays[0].windows.find((w) => w.label === "Early morning");
    expect(morningWindow.estimatedAqi).toBe(30);
    expect(morningWindow.rating).toBe("excellent");
    expect(res.body.forecastDays[0].overallRating).toBe("excellent"); // avg=45 → excellent (0-50)
  });

  it("assigns 'poor' rating for AQI 151+", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue({
      forecast: [{ day: today, avg: 180, min: 155, max: 210 }],
      cached: false,
    });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.body.forecastDays[0].overallRating).toBe("poor");
    expect(res.body.forecastDays[0].windows[0].rating).toBe("poor");
  });

  it("bestWindow is the window with lowest estimatedAqi", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue({
      forecast: [{ day: today, avg: 80, min: 20, max: 150 }],
      cached: false,
    });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    // min=20 → Early morning and Evening both use min; Early morning comes first
    expect(res.body.forecastDays[0].bestWindow).toBe("Early morning");
  });

  it("dayLabel is 'Today' for today's date", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue({
      forecast: [{ day: today, avg: 45, min: 30, max: 65 }],
      cached: false,
    });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.body.forecastDays[0].dayLabel).toBe("Today");
  });

  it("dayLabel is 'Tomorrow' for next date", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });
    aqiCache.getForecastForPoint.mockResolvedValue({
      forecast: [{ day: tomorrow, avg: 45, min: 30, max: 65 }],
      cached: false,
    });

    const res = await request(app)
      .get(`/api/v1/routes/saved/${ROUTE_ID}/departure-forecast`)
      .set("Authorization", "Bearer token");

    expect(res.body.forecastDays[0].dayLabel).toBe("Tomorrow");
  });
});
