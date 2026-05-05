jest.mock("../utils/supabase", () => ({
  adminClient: { auth: { getUser: jest.fn() } },
}));
jest.mock("../db/connection", () => ({ pool: { query: jest.fn() } }));
jest.mock("../db/redis", () => ({ redis: { get: jest.fn(), set: jest.fn() } }));
jest.mock("../utils/logger", () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use(authRouter);

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
  subscription_expires_at: null,
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

beforeEach(() => jest.clearAllMocks());

describe("GET /api/v1/me/exposure", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/v1/me/exposure");
    expect(res.status).toBe(401);
  });

  it("returns 403 for free-tier user", async () => {
    authAs(FREE_USER);

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("returns insufficient_data when user has fewer than 3 rides", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "1" }] }); // COUNT

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("insufficient_data");
    expect(res.body.currentRideCount).toBe(1);
    expect(res.body.minimumRidesRequired).toBe(3);
  });

  it("returns 200 with all three periods when user has 3+ rides", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "5" }] }); // COUNT

    const periodRow = {
      total_rides: "5",
      total_distance_m: "20000",
      weighted_avg_aqi: "40",
      first_ride_at: new Date().toISOString(),
    };
    pool.query
      .mockResolvedValueOnce({ rows: [periodRow] }) // last7
      .mockResolvedValueOnce({ rows: [periodRow] }) // last30
      .mockResolvedValueOnce({ rows: [{ ...periodRow, total_rides: "10" }] }); // allTime

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("available");
    expect(res.body.periods.last7Days).toBeDefined();
    expect(res.body.periods.last30Days).toBeDefined();
    expect(res.body.periods.allTime).toBeDefined();
    expect(res.body.periods.last7Days.weightedAvgAqi).toBe(40);
    expect(res.body.periods.last7Days.exposureScore).toBe(80);
    expect(res.body.periods.last7Days.ratioToWho).toBe(0.8);
    expect(res.body.periods.last7Days.whoComparison).toBe("below_guideline");
    expect(res.body.trend).toBeDefined();
  });

  it("returns whoComparison=moderate_concern when ratio is between 1.0 and 2.0", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "5" }] });

    const highRow = { total_rides: "5", total_distance_m: "10000", weighted_avg_aqi: "75", first_ride_at: new Date().toISOString() };
    pool.query
      .mockResolvedValueOnce({ rows: [highRow] })
      .mockResolvedValueOnce({ rows: [highRow] })
      .mockResolvedValueOnce({ rows: [highRow] });

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.body.periods.last7Days.ratioToWho).toBe(1.5);
    expect(res.body.periods.last7Days.whoComparison).toBe("moderate_concern");
  });

  it("returns whoComparison=high_concern when ratio exceeds 2.0", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "5" }] });

    const veryHighRow = { total_rides: "5", total_distance_m: "10000", weighted_avg_aqi: "110", first_ride_at: new Date().toISOString() };
    pool.query
      .mockResolvedValueOnce({ rows: [veryHighRow] })
      .mockResolvedValueOnce({ rows: [veryHighRow] })
      .mockResolvedValueOnce({ rows: [veryHighRow] });

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.body.periods.last7Days.whoComparison).toBe("high_concern");
  });

  it("returns trend=improving when last7 avg < last30 avg", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "10" }] });

    pool.query
      .mockResolvedValueOnce({ rows: [{ total_rides: "3", total_distance_m: "10000", weighted_avg_aqi: "30", first_ride_at: new Date().toISOString() }] }) // last7 (lower)
      .mockResolvedValueOnce({ rows: [{ total_rides: "7", total_distance_m: "30000", weighted_avg_aqi: "50", first_ride_at: new Date().toISOString() }] }) // last30 (higher)
      .mockResolvedValueOnce({ rows: [{ total_rides: "10", total_distance_m: "40000", weighted_avg_aqi: "45", first_ride_at: new Date().toISOString() }] }); // allTime

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.body.trend).toBe("improving");
  });

  it("returns trend=stable when difference < 5 AQI points", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ total_rides: "10" }] });

    pool.query
      .mockResolvedValueOnce({ rows: [{ total_rides: "3", total_distance_m: "10000", weighted_avg_aqi: "42", first_ride_at: new Date().toISOString() }] }) // last7
      .mockResolvedValueOnce({ rows: [{ total_rides: "7", total_distance_m: "30000", weighted_avg_aqi: "44", first_ride_at: new Date().toISOString() }] }) // last30
      .mockResolvedValueOnce({ rows: [{ total_rides: "10", total_distance_m: "40000", weighted_avg_aqi: "43", first_ride_at: new Date().toISOString() }] }); // allTime

    const res = await request(app)
      .get("/api/v1/me/exposure")
      .set("Authorization", "Bearer token");

    expect(res.body.trend).toBe("stable");
  });
});
