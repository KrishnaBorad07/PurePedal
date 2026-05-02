jest.mock("../utils/supabase", () => ({
  adminClient: {
    auth: { getUser: jest.fn() },
  },
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
const ors = require("../services/ors");
const scoringClient = require("../services/scoringClient");
const routesRouter = require("../routes/routes");
const { OrsApiError, OrsNoRouteError } = require("../utils/errors");

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
  scoring_weights: { aqi: 0.5, distance: 0.3, elevation: 0.2 },
  created_at: new Date().toISOString(),
};

const PREMIUM_USER = { ...FREE_USER, id: "user-premium-uuid", subscription_status: "premium" };

const ORIGIN = { lat: 19.076, lng: 72.877 };
const DESTINATION = { lat: 19.113, lng: 72.869 };

const MOCK_ROUTES = [
  {
    id: "ors:0",
    type: "recommended",
    geometry: { type: "LineString", coordinates: [[72.877, 19.076]] },
    distance_m: 5200,
    duration_s: 1080,
    elevation_gain_m: 10,
    elevation_loss_m: 5,
    instructions: [{ text: "Head north", distance_m: 100, duration_s: 30 }],
    bbox: [],
  },
];

const SCORED_RESPONSE = {
  routes: [
    {
      id: "ors:0",
      type: "recommended",
      rank: 1,
      geometry: { type: "LineString", coordinates: [[72.877, 19.076]] },
      distance_m: 5200,
      duration_s: 1080,
      elevation_gain_m: 10,
      instructions: [],
      score: { final: 84.2, aqi: 91, distance: 78.5, elevation: 88, avgAqi: 28, maxAqi: 45 },
    },
  ],
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
  // Default: routes are not cached
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue("OK");
  ors.getCyclingRoutes.mockResolvedValue(MOCK_ROUTES);
  scoringClient.scoreRoutes.mockResolvedValue(SCORED_RESPONSE);
});

// ── POST /routes/suggest ──────────────────────────────────────────────────────

describe("POST /api/v1/routes/suggest", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .send({ origin: ORIGIN, destination: DESTINATION });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing origin", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ destination: DESTINATION });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/origin/i);
  });

  it("returns 400 when origin equals destination (within 10m)", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: ORIGIN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same location/i);
  });

  it("returns 400 when distance exceeds 100km", async () => {
    authAs(FREE_USER);
    const farDest = { lat: 28.6139, lng: 77.2090 }; // Delhi — far from Mumbai
    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: farDest });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100km/i);
  });

  it("returns 200 with ranked routes on valid request", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: DESTINATION });

    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.routes[0].label).toBe("Cleanest");
    expect(res.body.recommendedRouteId).toBe("ors:0");
    expect(res.body.cachedRoutes).toBe(false);
  });

  it("returns 422 when ORS returns no routes", async () => {
    authAs(FREE_USER);
    ors.getCyclingRoutes.mockRejectedValue(
      new OrsNoRouteError("No route found.")
    );

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: DESTINATION });

    expect(res.status).toBe(422);
  });

  it("returns 502 when ORS is unreachable", async () => {
    authAs(FREE_USER);
    ors.getCyclingRoutes.mockRejectedValue(new OrsApiError("ORS down"));

    const res = await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: DESTINATION });

    expect(res.status).toBe(502);
  });

  it("ignores custom weights for free-tier users and uses stored weights", async () => {
    authAs(FREE_USER);
    const customWeights = { aqi: 0.9, distance: 0.05, elevation: 0.05 };

    await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: DESTINATION, preferences: { weights: customWeights } });

    const calledWeights = scoringClient.scoreRoutes.mock.calls[0][1];
    expect(calledWeights).toEqual(FREE_USER.scoring_weights);
    expect(calledWeights).not.toEqual(customWeights);
  });

  it("uses custom weights for premium users when provided", async () => {
    authAs(PREMIUM_USER);
    const customWeights = { aqi: 0.9, distance: 0.05, elevation: 0.05 };

    await request(app)
      .post("/api/v1/routes/suggest")
      .set("Authorization", "Bearer valid-token")
      .send({ origin: ORIGIN, destination: DESTINATION, preferences: { weights: customWeights } });

    const calledWeights = scoringClient.scoreRoutes.mock.calls[0][1];
    expect(calledWeights).toEqual(customWeights);
  });
});

// ── GET /routes/saved ─────────────────────────────────────────────────────────

describe("GET /api/v1/routes/saved", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/v1/routes/saved");
    expect(res.status).toBe(401);
  });

  it("returns 200 with saved routes for free user", async () => {
    authAs(FREE_USER);
    const savedRoutes = [
      { id: "route-uuid", name: "Morning commute", distance_m: 5200 },
    ];
    pool.query.mockResolvedValueOnce({ rows: savedRoutes });

    const res = await request(app)
      .get("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.limit).toBe(3);
    expect(res.body.canSaveMore).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it("returns null limit and canSaveMore=true for premium user", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBeNull();
    expect(res.body.canSaveMore).toBe(true);
  });
});

// ── POST /routes/saved ────────────────────────────────────────────────────────

describe("POST /api/v1/routes/saved", () => {
  const VALID_BODY = {
    name: "Morning commute",
    geometry: {
      type: "LineString",
      coordinates: [
        [72.877, 19.076],
        [72.869, 19.113],
      ],
    },
    distance_m: 5200,
    elevation_gain_m: 12,
    aqi_at_save: 28,
    tags: ["commute"],
  };

  it("returns 201 for valid route from free user", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // free tier count check
    pool.query.mockResolvedValueOnce({
      rows: [{ ...VALID_BODY, id: "new-uuid", tags: [], collection_id: null, created_at: new Date() }],
    });

    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Morning commute");
  });

  it("returns 403 with upgradeRequired when free user already has 3 saved routes", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.upgradeRequired).toBe(true);
    expect(res.body.error).toMatch(/free tier limit/i);
  });

  it("silently drops tags for free-tier users", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ ...VALID_BODY, id: "new-uuid", tags: [], collection_id: null, created_at: new Date() }],
    });

    await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, tags: ["commute", "morning"] });

    const insertCall = pool.query.mock.calls.find((c) => c[0].includes("saved_routes") && c[0].includes("INSERT"));
    // tags parameter (index 6, $7) should be empty array for free users
    expect(insertCall[1][6]).toEqual([]);
  });

  it("returns 400 for missing name", async () => {
    authAs(FREE_USER);
    const { name, ...bodyWithoutName } = VALID_BODY;
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send(bodyWithoutName);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it("returns 400 for invalid geometry (missing coordinates)", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/routes/saved")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, geometry: { type: "LineString", coordinates: [[72.877, 19.076]] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geometry/i);
  });
});

// ── DELETE /routes/saved/:id ──────────────────────────────────────────────────

describe("DELETE /api/v1/routes/saved/:id", () => {
  it("returns 200 for own route", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: FREE_USER.id }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it("returns 403 when trying to delete another user's route", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [{ id: "route-uuid", user_id: "other-user-uuid" }] });

    const res = await request(app)
      .delete("/api/v1/routes/saved/route-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent route", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .delete("/api/v1/routes/saved/nonexistent-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});
