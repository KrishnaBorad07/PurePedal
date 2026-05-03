jest.mock("../utils/supabase", () => ({
  adminClient: {
    auth: { getUser: jest.fn() },
  },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const notificationsRouter = require("../routes/notifications");

const app = express();
app.use(express.json());
app.use(notificationsRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

const MOCK_USER = {
  id: "user-uuid",
  email: "test@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "free",
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
    .mockResolvedValueOnce({ rows: [] })       // syncUser INSERT ON CONFLICT
    .mockResolvedValueOnce({ rows: [user] });   // syncUser SELECT
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── POST /api/v1/notifications/token ─────────────────────────────────────────

describe("POST /api/v1/notifications/token", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app)
      .post("/api/v1/notifications/token")
      .send({ token: "ExponentPushToken[abc]", platform: "ios" });

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid token format", async () => {
    authAs(MOCK_USER);

    const res = await request(app)
      .post("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "InvalidToken123", platform: "ios" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ExponentPushToken/);
  });

  it("returns 400 for missing platform", async () => {
    authAs(MOCK_USER);

    const res = await request(app)
      .post("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[abc123]" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/);
  });

  it("returns 400 for invalid platform value", async () => {
    authAs(MOCK_USER);

    const res = await request(app)
      .post("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[abc123]", platform: "windows" });

    expect(res.status).toBe(400);
  });

  it("returns 200 and upserts token for valid request", async () => {
    authAs(MOCK_USER);
    pool.query.mockResolvedValueOnce({ rows: [] }); // the upsert

    const res = await request(app)
      .post("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[abc123]", platform: "ios" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Push token registered successfully.");
  });

  it("upserts correctly and does not create duplicate rows on repeated calls", async () => {
    authAs(MOCK_USER);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ON CONFLICT DO UPDATE

    await request(app)
      .post("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[abc123]", platform: "android" });

    const upsertCall = pool.query.mock.calls.find(
      ([sql]) => sql && sql.includes("push_tokens") && sql.includes("ON CONFLICT")
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall[0]).toMatch(/ON CONFLICT \(user_id, token\) DO UPDATE/);
  });
});

// ── DELETE /api/v1/notifications/token ───────────────────────────────────────

describe("DELETE /api/v1/notifications/token", () => {
  it("returns 200 and removes the token", async () => {
    authAs(MOCK_USER);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

    const res = await request(app)
      .delete("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[abc123]" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Push token removed successfully.");
  });

  it("returns 200 even if token does not exist (idempotent)", async () => {
    authAs(MOCK_USER);
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // DELETE — nothing deleted

    const res = await request(app)
      .delete("/api/v1/notifications/token")
      .set("Authorization", "Bearer valid-token")
      .send({ token: "ExponentPushToken[nonexistent]" });

    expect(res.status).toBe(200);
  });
});
