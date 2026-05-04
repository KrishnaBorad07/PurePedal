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
const collectionsRouter = require("../routes/collections");

const app = express();
app.use(express.json());
app.use(collectionsRouter);
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
};

const COL_UUID = "a0000000-0000-0000-0000-000000000001";

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

// ── POST /collections ─────────────────────────────────────────────────────────

describe("POST /api/v1/collections", () => {
  it("returns 403 for free user", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/collections")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Weekend rides" });

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });

  it("returns 201 with valid name for premium user", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // count check
    pool.query.mockResolvedValueOnce({
      rows: [{ id: COL_UUID, name: "Weekend rides", created_at: new Date().toISOString() }],
    });

    const res = await request(app)
      .post("/api/v1/collections")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Weekend rides" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Weekend rides");
    expect(res.body.routeCount).toBe(0);
  });

  it("returns 400 when name exceeds 50 characters", async () => {
    authAs(PREMIUM_USER);
    const res = await request(app)
      .post("/api/v1/collections")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "A".repeat(51) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50 characters/i);
  });

  it("returns 400 when user already has 20 collections", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "20" }] });

    const res = await request(app)
      .post("/api/v1/collections")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "New collection" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum of 20/i);
  });
});

// ── GET /collections ──────────────────────────────────────────────────────────

describe("GET /api/v1/collections", () => {
  it("returns 200 with routeCount per collection", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: COL_UUID, name: "Weekend rides", created_at: new Date().toISOString(), route_count: 3 },
      ],
    });

    const res = await request(app)
      .get("/api/v1/collections")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(1);
    expect(res.body.collections[0].routeCount).toBe(3);
    expect(res.body.count).toBe(1);
  });
});

// ── PATCH /collections/:id ────────────────────────────────────────────────────

describe("PATCH /api/v1/collections/:id", () => {
  it("returns 200 with updated name", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: COL_UUID, user_id: PREMIUM_USER.id }] }) // ownership check
      .mockResolvedValueOnce({
        rows: [{ id: COL_UUID, name: "Morning commutes", created_at: new Date().toISOString() }],
      });

    const res = await request(app)
      .patch(`/api/v1/collections/${COL_UUID}`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Morning commutes" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Morning commutes");
  });

  it("returns 403 for another user's collection", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: COL_UUID, user_id: "other-user-uuid" }],
    });

    const res = await request(app)
      .patch(`/api/v1/collections/${COL_UUID}`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Stolen name" });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /collections/:id ───────────────────────────────────────────────────

describe("DELETE /api/v1/collections/:id", () => {
  it("returns 200 and collection_id is set to null on routes (FK cascade)", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: COL_UUID, user_id: PREMIUM_USER.id }] }) // ownership
      .mockResolvedValueOnce({ rows: [{ count: "3" }] }) // route count
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    const res = await request(app)
      .delete(`/api/v1/collections/${COL_UUID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/3 routes moved to uncollected/i);
  });

  it("includes correct route count in message", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: COL_UUID, user_id: PREMIUM_USER.id }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete(`/api/v1/collections/${COL_UUID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/1 route moved to uncollected/i);
  });
});
