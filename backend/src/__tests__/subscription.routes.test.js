jest.mock("../utils/supabase", () => ({
  adminClient: {
    auth: { getUser: jest.fn() },
  },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

const express = require("express");
const request = require("supertest");
const { adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use(authRouter);

const BASE_USER = {
  id: "user-uuid",
  email: "test@example.com",
  display_name: null,
  home_location: null,
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
  created_at: new Date().toISOString(),
};

function mockAuth() {
  adminClient.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-uuid", email: "test@example.com" } },
    error: null,
  });
}

function mockDbUser(overrides) {
  const user = { ...BASE_USER, ...overrides };
  pool.query.mockResolvedValue({ rows: [user] });
  return user;
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/v1/me/subscription", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/api/v1/me/subscription");
    expect(res.status).toBe(401);
  });

  test("returns canAccessPremium: false for free user", async () => {
    mockAuth();
    mockDbUser({ subscription_status: "free", subscription_expires_at: null });

    const res = await request(app)
      .get("/api/v1/me/subscription")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "free",
      expiresAt: null,
      isActive: false,
      canAccessPremium: false,
    });
  });

  test("returns canAccessPremium: false for lapsed user", async () => {
    mockAuth();
    mockDbUser({ subscription_status: "lapsed", subscription_expires_at: null });

    const res = await request(app)
      .get("/api/v1/me/subscription")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "lapsed",
      isActive: false,
      canAccessPremium: false,
    });
  });

  test("returns canAccessPremium: true for active premium user", async () => {
    mockAuth();
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    mockDbUser({ subscription_status: "premium", subscription_expires_at: futureDate });

    const res = await request(app)
      .get("/api/v1/me/subscription")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "premium",
      isActive: true,
      canAccessPremium: true,
    });
  });

  test("returns canAccessPremium: false when status is premium but expiry is in the past", async () => {
    mockAuth();
    const pastDate = new Date(Date.now() - 1000).toISOString();
    mockDbUser({ subscription_status: "premium", subscription_expires_at: pastDate });

    const res = await request(app)
      .get("/api/v1/me/subscription")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "premium",
      isActive: false,
      canAccessPremium: false,
    });
  });
});
