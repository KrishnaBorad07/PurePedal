jest.mock("../utils/supabase", () => ({
  adminClient: { auth: { getUser: jest.fn() } },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

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
const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use(authRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

const PREMIUM_USER = {
  id: "user-premium-uuid",
  email: "premium@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "premium",
  subscription_expires_at: null,
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
  created_at: new Date().toISOString(),
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

describe("PATCH /api/v1/me/scoring-weights — validation", () => {
  it("returns 400 when weights do not sum to 1.0", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0.5, distance: 0.2, elevation: 0.1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum/i);
  });

  it("returns 400 when any weight is negative", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: -0.1, distance: 0.6, elevation: 0.5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.0 and 1\.0/i);
  });

  it("returns 400 when any weight exceeds 1.0", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 1.1, distance: 0.0, elevation: 0.0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0\.0 and 1\.0/i);
  });

  it("returns 400 when all weights are zero", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0, distance: 0, elevation: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum/i);
  });

  it("returns 400 when any key is missing", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0.7, distance: 0.3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 200 with valid weights summing to 1.0", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ scoring_weights: { aqi: 0.7, distance: 0.2, elevation: 0.1 } }],
    });

    const res = await request(app)
      .patch("/api/v1/me/scoring-weights")
      .set("Authorization", "Bearer valid-token")
      .send({ aqi: 0.7, distance: 0.2, elevation: 0.1 });

    expect(res.status).toBe(200);
    expect(res.body.scoringWeights).toEqual({ aqi: 0.7, distance: 0.2, elevation: 0.1 });
    expect(res.body.message).toMatch(/updated successfully/i);
  });
});
