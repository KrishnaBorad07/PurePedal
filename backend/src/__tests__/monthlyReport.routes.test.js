jest.mock("../utils/supabase", () => {
  const createSignedUrl = jest.fn();
  const from = jest.fn(() => ({ createSignedUrl }));
  return {
    adminClient: {
      auth: { getUser: jest.fn() },
      storage: { from },
    },
    _createSignedUrl: createSignedUrl,
    _from: from,
  };
});
jest.mock("../db/connection", () => ({ pool: { query: jest.fn() } }));
jest.mock("../db/redis", () => ({ redis: { get: jest.fn(), set: jest.fn() } }));
jest.mock("../services/aqiCache");
jest.mock("../utils/logger", () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { adminClient, _createSignedUrl } = require("../utils/supabase");
const { pool } = require("../db/connection");
const ridesRouter = require("../routes/rides");

const app = express();
app.use(express.json());
app.use(ridesRouter);

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

describe("GET /api/v1/rides/summary/monthly", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/v1/rides/summary/monthly?month=4&year=2026");
    expect(res.status).toBe(401);
  });

  it("returns 403 for free-tier user", async () => {
    authAs(FREE_USER);

    const res = await request(app)
      .get("/api/v1/rides/summary/monthly?month=4&year=2026")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("returns 400 when month is invalid", async () => {
    authAs(PREMIUM_USER);

    const res = await request(app)
      .get("/api/v1/rides/summary/monthly?month=13&year=2026")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/month/i);
  });

  it("returns 400 when month is missing", async () => {
    authAs(PREMIUM_USER);

    const res = await request(app)
      .get("/api/v1/rides/summary/monthly?year=2026")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
  });

  it("returns 404 when report has not been generated", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [] }); // no report_metadata row

    const res = await request(app)
      .get("/api/v1/rides/summary/monthly?month=4&year=2026")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no report available/i);
  });

  it("returns 200 with downloadUrl when report exists", async () => {
    authAs(PREMIUM_USER);
    const generatedAt = new Date().toISOString();
    pool.query.mockResolvedValueOnce({
      rows: [{ file_path: "premium-uuid/2026-04-report.pdf", generated_at: generatedAt }],
    });
    _createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://supabase.example.com/signed-url" },
      error: null,
    });

    const res = await request(app)
      .get("/api/v1/rides/summary/monthly?month=4&year=2026")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.month).toBe(4);
    expect(res.body.year).toBe(2026);
    expect(res.body.label).toBe("April 2026");
    expect(res.body.downloadUrl).toBe("https://supabase.example.com/signed-url");
    expect(res.body.urlExpiresAt).toBeDefined();
    expect(res.body.generatedAt).toBe(generatedAt);
  });
});
