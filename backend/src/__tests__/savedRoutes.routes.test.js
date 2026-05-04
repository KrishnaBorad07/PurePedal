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
const routesRouter = require("../routes/routes");

const app = express();
app.use(express.json());
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
};

const MOCK_ROUTE_ROW = {
  id: "route-uuid",
  name: "Morning commute",
  distance_m: 5200,
  elevation_gain_m: 12,
  aqi_at_save: 28,
  tags: ["commute"],
  collection_id: null,
  collection_name: null,
  created_at: new Date().toISOString(),
  geometry: { type: "LineString", coordinates: [[72.8777, 19.076], [72.88, 19.08]] },
  aqi_samples: [{ lat: 19.076, lng: 72.8777, aqi: 24, distanceM: 0 }],
  score_breakdown: { final: 84.2, aqi: 91.0, distance: 78.5, elevation: 88.0, avgAqi: 28.4, maxAqi: 45 },
};

const VALID_BODY = {
  name: "Morning commute",
  geometry: { type: "LineString", coordinates: [[72.877, 19.076], [72.869, 19.113]] },
  distance_m: 5200,
  elevation_gain_m: 12,
  aqi_at_save: 28,
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
  scoringClient.scoreRoutes.mockResolvedValue({ routes: [] });
});

// ── GET /routes/saved/:id ─────────────────────────────────────────────────────

describe("GET /api/v1/routes/saved/:id", () => {
  it("returns 200 with geometry for own route (free user)", async () => {
    authAs(FREE_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: FREE_USER.id }] })
      .mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });

    const res = await request(app)
      .get("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.geometry).toBeDefined();
    expect(res.body.geometry.type).toBe("LineString");
  });

  it("returns 403 for another user's route", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "route-uuid", user_id: "other-user-uuid" }],
    });

    const res = await request(app)
      .get("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent route", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/v1/routes/saved/nonexistent-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("omits aqiSamples and scoreBreakdown for free user", async () => {
    authAs(FREE_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: FREE_USER.id }] })
      .mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });

    const res = await request(app)
      .get("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.aqiSamples).toBeUndefined();
    expect(res.body.scoreBreakdown).toBeUndefined();
  });

  it("includes aqiSamples and scoreBreakdown for premium user", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: PREMIUM_USER.id }] })
      .mockResolvedValueOnce({ rows: [MOCK_ROUTE_ROW] });

    const res = await request(app)
      .get("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.aqiSamples).toEqual(MOCK_ROUTE_ROW.aqi_samples);
    expect(res.body.scoreBreakdown).toEqual(MOCK_ROUTE_ROW.score_breakdown);
  });

  it("returns aqiSamples: null when column is null (premium user)", async () => {
    authAs(PREMIUM_USER);
    const rowWithNulls = { ...MOCK_ROUTE_ROW, aqi_samples: null, score_breakdown: null };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: PREMIUM_USER.id }] })
      .mockResolvedValueOnce({ rows: [rowWithNulls] });

    const res = await request(app)
      .get("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.aqiSamples).toBeNull();
    expect(res.body.scoreBreakdown).toBeNull();
  });
});

// ── POST /routes/saved — aqi_samples + score_breakdown ───────────────────────

describe("POST /api/v1/routes/saved — Sprint 7 fields", () => {
  it("accepts and stores aqi_samples correctly", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...VALID_BODY, id: "new-uuid", tags: [], collection_id: null, created_at: new Date() }],
    });

    const aqiSamples = [{ lat: 19.076, lng: 72.877, aqi: 24, distanceM: 0 }];
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, aqi_samples: aqiSamples });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT") && c[0].includes("saved_routes")
    );
    expect(insertCall[1][7]).toEqual(JSON.stringify(aqiSamples)); // $8 = aqi_samples (JSON string for pg)
  });

  it("accepts and stores score_breakdown correctly", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...VALID_BODY, id: "new-uuid", tags: [], collection_id: null, created_at: new Date() }],
    });

    const scoreBreakdown = { final: 84.2, aqi: 91.0, distance: 78.5, elevation: 88.0, avgAqi: 28.4, maxAqi: 45 };
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, score_breakdown: scoreBreakdown });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT") && c[0].includes("saved_routes")
    );
    expect(insertCall[1][8]).toEqual(JSON.stringify(scoreBreakdown)); // $9 = score_breakdown (JSON string for pg)
  });

  it("returns 400 for invalid aqi_samples shape (missing field)", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({
        ...VALID_BODY,
        aqi_samples: [{ lat: 19.076, lng: 72.877, aqi: 24 }], // missing distanceM
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aqi_samples/i);
  });

  it("returns 400 for aqi_samples that is not an array", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, aqi_samples: "not-an-array" });

    expect(res.status).toBe(400);
  });
});

// ── GET /routes/saved — tag and collection filtering ─────────────────────────

describe("GET /api/v1/routes/saved — filters", () => {
  it("filters by tag correctly", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "r1", name: "Commute", tags: ["commute"], collection_id: null, collection_name: null }],
    });

    const res = await request(app)
      .get("/api/v1/routes/saved?tag=commute")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    // Verify tag param was passed lowercased
    const queryCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("saved_routes")
    );
    expect(queryCall[1][1]).toBe("commute");
  });

  it("filters by collectionId correctly", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ id: "r1", name: "Route", collection_id: "col-uuid" }] });

    const res = await request(app)
      .get("/api/v1/routes/saved?collectionId=col-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const queryCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("saved_routes")
    );
    expect(queryCall[0]).toMatch(/collection_id.*uuid/i);
  });

  it("returns uncollected routes when collectionId is uncollected", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ id: "r1", name: "Route", collection_id: null }] });

    const res = await request(app)
      .get("/api/v1/routes/saved?collectionId=uncollected")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const queryCall = pool.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("saved_routes")
    );
    expect(queryCall[0]).toMatch(/collection_id IS NULL/i);
  });
});

// ── PATCH /routes/saved/:id/collection ───────────────────────────────────────

describe("PATCH /api/v1/routes/saved/:id/collection", () => {
  const COL_UUID = "a0000000-0000-0000-0000-000000000001";

  it("moves route to collection (premium user)", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: PREMIUM_USER.id }] }) // route check
      .mockResolvedValueOnce({ rows: [{ id: COL_UUID, user_id: PREMIUM_USER.id }] }) // collection check
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", collection_id: COL_UUID }] }); // UPDATE

    const res = await request(app)
      .patch("/api/v1/routes/saved/route-uuid/collection")
      .set("Authorization", "Bearer valid-token")
      .send({ collectionId: COL_UUID });

    expect(res.status).toBe(200);
    expect(res.body.collectionId).toBe(COL_UUID);
    expect(res.body.message).toMatch(/moved to collection/i);
  });

  it("removes route from collection when collectionId is null", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: PREMIUM_USER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", collection_id: null }] });

    const res = await request(app)
      .patch("/api/v1/routes/saved/route-uuid/collection")
      .set("Authorization", "Bearer valid-token")
      .send({ collectionId: null });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removed from collection/i);
  });

  it("returns 403 for collection belonging to another user", async () => {
    authAs(PREMIUM_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: PREMIUM_USER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: COL_UUID, user_id: "other-user-uuid" }] });

    const res = await request(app)
      .patch("/api/v1/routes/saved/route-uuid/collection")
      .set("Authorization", "Bearer valid-token")
      .send({ collectionId: COL_UUID });

    expect(res.status).toBe(403);
  });

  it("returns 403 for free user", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .patch("/api/v1/routes/saved/route-uuid/collection")
      .set("Authorization", "Bearer valid-token")
      .send({ collectionId: null });

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
  });
});
