jest.mock("../utils/supabase", () => ({
  adminClient: { auth: { getUser: jest.fn() } },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../db/redis", () => ({
  redis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

jest.mock("../services/ors");
jest.mock("../services/scoringClient");

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
const { redis } = require("../db/redis");
const scoringClient = require("../services/scoringClient");
const authRouter = require("../routes/auth");
const routesRouter = require("../routes/routes");

const app = express();
app.use(express.json());
app.use(authRouter);
app.use(routesRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

const FREE_USER = {
  id: "user-free-uuid",
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
  id: "user-premium-uuid",
  email: "premium@example.com",
  subscription_status: "premium",
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
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
});

describe("PATCH /api/v1/me/scoring-weights", () => {
  it("returns 403 for free user", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0.7, distance: 0.2, elevation: 0.1 });

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("returns 400 for weights not summing to 1.0", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0.5, distance: 0.2, elevation: 0.1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum/i);
    expect(res.body.error).toMatch(/0\.80/);
  });

  it("returns 200 and persists weights for premium user", async () => {
    authAs(PREMIUM_USER);
    const updatedWeights = { aqi: 0.7, distance: 0.2, elevation: 0.1 };
    pool.query.mockResolvedValueOnce({
      rows: [{ scoring_weights: updatedWeights }],
    });

    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send(updatedWeights);

    expect(res.status).toBe(200);
    expect(res.body.scoringWeights).toEqual(updatedWeights);
    expect(res.body.message).toMatch(/updated successfully/i);

    // Verify the DB was called with the correct weights
    const updateCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("UPDATE users")
    );
    expect(updateCall[1][0]).toEqual(updatedWeights);
  });

  it("updated weights are used in next /routes/suggest call", async () => {
    const UPDATED_WEIGHTS = { aqi: 0.8, distance: 0.1, elevation: 0.1 };
    const userWithNewWeights = { ...PREMIUM_USER, scoring_weights: UPDATED_WEIGHTS };

    // Auth for /routes/suggest — syncUser returns user with updated weights
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: PREMIUM_USER.id, email: PREMIUM_USER.email } },
      error: null,
    });
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [userWithNewWeights] });

    const scoredResponse = { routes: [{ id: "ors:0", rank: 1, score: { final: 90 } }] };
    scoringClient.scoreRoutes.mockResolvedValue(scoredResponse);
    // routeCache miss → ors mock not needed; mock routeCache via redis
    const ors = require("../services/ors");
    ors.getCyclingRoutes.mockResolvedValue([
      {
        id: "ors:0",
        geometry: { type: "LineString", coordinates: [[72.877, 19.076], [72.88, 19.08]] },
        distance_m: 5200,
        duration_s: 900,
        elevation_gain_m: 10,
        elevation_loss_m: 5,
        instructions: [],
        bbox: [],
      },
    ]);

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({
        origin: { lat: 19.076, lng: 72.877 },
        destination: { lat: 19.113, lng: 72.869 },
      });

    expect(res.status).toBe(200);
    const calledWeights = scoringClient.scoreRoutes.mock.calls[0][1];
    expect(calledWeights).toEqual(UPDATED_WEIGHTS);
  });
});
