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

jest.mock("../services/aqiCache", () => ({
  getAqiForPoint: jest.fn(),
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
const aqiCache = require("../services/aqiCache");
const ridesRouter = require("../routes/rides");

const app = express();
app.use(express.json());
app.use(ridesRouter);
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

// home_location as a JSON string — matches what ST_AsGeoJSON returns from the DB
const FREE_USER_WITH_HOME = {
  ...FREE_USER,
  home_location: '{"type":"Point","coordinates":[72.8777,19.076]}',
};

const PREMIUM_USER = { ...FREE_USER, id: "user-premium-uuid", subscription_status: "premium" };

const FREE_USER_NO_HOME = FREE_USER;

const VALID_TRACK = {
  type: "LineString",
  coordinates: [
    [72.877, 19.076],
    [72.878, 19.077],
  ],
};

const VALID_BODY = {
  startedAt: "2026-04-30T07:00:00Z",
  endedAt: "2026-04-30T07:42:15Z",
  track: VALID_TRACK,
  savedRouteId: null,
};

function authAs(user) {
  adminClient.auth.getUser.mockResolvedValue({
    data: { user: { id: user.id, email: user.email } },
    error: null,
  });
  pool.query
    .mockResolvedValueOnce({ rows: [] }) // syncUser INSERT ON CONFLICT
    .mockResolvedValueOnce({ rows: [{ ...user }] }); // syncUser SELECT — copy to avoid syncUser mutating the module-level constant
}

beforeEach(() => {
  jest.resetAllMocks();
  aqiCache.getAqiForPoint.mockResolvedValue(25);
});

// ── POST /api/v1/rides ────────────────────────────────────────────────────────

describe("POST /api/v1/rides", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).post("/api/v1/rides").send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 400 for duration under 60 seconds", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send({
        ...VALID_BODY,
        startedAt: "2026-04-30T07:00:00Z",
        endedAt: "2026-04-30T07:00:30Z",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/60 seconds/i);
  });

  it("returns 400 for track with fewer than 2 points", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send({
        ...VALID_BODY,
        track: { type: "LineString", coordinates: [[72.877, 19.076]] },
      });
    expect(res.status).toBe(400);
  });

  it("returns 400 for endedAt before startedAt", async () => {
    authAs(FREE_USER);
    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send({
        ...VALID_BODY,
        startedAt: "2026-04-30T08:00:00Z",
        endedAt: "2026-04-30T07:00:00Z",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before endedAt/i);
  });

  it("returns 201 with valid payload", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "ride-uuid", created_at: new Date().toISOString() }],
    });

    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("ride-uuid");
    expect(res.body.distance_m).toBeGreaterThan(0);
    expect(res.body.duration_seconds).toBe(2535);
    expect(res.body).not.toHaveProperty("aqi_samples");
    expect(res.body).not.toHaveProperty("track_geometry");
  });

  it("returns 403 for savedRouteId belonging to another user", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "saved-route-uuid", user_id: "other-user-uuid" }],
    });

    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, savedRouteId: "saved-route-uuid" });

    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent savedRouteId", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/v1/rides")
      .set("Authorization", "Bearer valid-token")
      .send({ ...VALID_BODY, savedRouteId: "nonexistent-uuid" });

    expect(res.status).toBe(404);
  });
});

// ── GET /api/v1/rides ─────────────────────────────────────────────────────────

describe("GET /api/v1/rides", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/v1/rides");
    expect(res.status).toBe(401);
  });

  it("returns 200 with paginated results", async () => {
    authAs(FREE_USER);
    const mockRides = [
      {
        id: "ride-uuid",
        started_at: "2026-04-30T07:00:00Z",
        ended_at: "2026-04-30T07:42:15Z",
        distance_m: 12800,
        duration_seconds: 2535,
        avg_aqi: "28.4",
        max_aqi: "45",
        saved_route_id: null,
        created_at: new Date().toISOString(),
        saved_route_name: null,
      },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: mockRides })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const res = await request(app)
      .get("/api/v1/rides")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.rides).toHaveLength(1);
    expect(res.body.rides[0].aqiCategory).toBe("good");
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.page).toBe(1);
  });

  it("respects from and to date filters", async () => {
    authAs(FREE_USER);
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const res = await request(app)
      .get("/api/v1/rides?from=2026-04-01&to=2026-04-30")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls[2]; // 0=syncInsert, 1=syncSelect, 2=rides query
    expect(listCall[1][1]).toBe("2026-04-01");
    expect(listCall[1][2]).toBe("2026-04-30");
  });
});

// ── GET /api/v1/rides/:id ─────────────────────────────────────────────────────

describe("GET /api/v1/rides/:id", () => {
  const MOCK_RIDE_ROW = {
    id: "ride-uuid",
    user_id: FREE_USER.id,
    started_at: "2026-04-30T07:00:00Z",
    ended_at: "2026-04-30T07:42:15Z",
    distance_m: 12800,
    duration_seconds: 2535,
    avg_aqi: "28.4",
    max_aqi: "45",
    saved_route_id: null,
    created_at: new Date().toISOString(),
    saved_route_name: null,
    aqi_samples: [{ lat: 19.076, lng: 72.877, aqi: 25, distanceFromStart_m: 0 }],
    track_geometry: JSON.stringify({ type: "LineString", coordinates: [[72.877, 19.076]] }),
  };

  it("returns 200 for own ride", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_RIDE_ROW] });

    const res = await request(app)
      .get("/api/v1/rides/ride-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ride-uuid");
  });

  it("returns 403 for another user's ride", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_RIDE_ROW, user_id: "other-user-uuid" }],
    });

    const res = await request(app)
      .get("/api/v1/rides/ride-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("omits aqiSamples and trackGeometry for free user", async () => {
    authAs(FREE_USER);
    pool.query.mockResolvedValueOnce({ rows: [MOCK_RIDE_ROW] });

    const res = await request(app)
      .get("/api/v1/rides/ride-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("aqiSamples");
    expect(res.body).not.toHaveProperty("trackGeometry");
  });

  it("includes aqiSamples and trackGeometry for premium user", async () => {
    authAs(PREMIUM_USER);
    pool.query.mockResolvedValueOnce({
      rows: [{ ...MOCK_RIDE_ROW, user_id: PREMIUM_USER.id }],
    });

    const res = await request(app)
      .get("/api/v1/rides/ride-uuid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("aqiSamples");
    expect(res.body).toHaveProperty("trackGeometry");
  });
});

// ── GET /api/v1/rides/summary/weekly ─────────────────────────────────────────

describe("GET /api/v1/rides/summary/weekly", () => {
  it("returns 200 with correct week boundaries", async () => {
    authAs(FREE_USER);
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            total_rides: "4",
            total_distance_m: "38400",
            total_duration_seconds: "9140",
            avg_aqi: "31.2",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "ride-clean", started_at: "2026-04-28T06:30:00Z", distance_m: 8400, avg_aqi: "18.0" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "ride-polluted", started_at: "2026-04-30T08:00:00Z", distance_m: 12800, avg_aqi: "67.5" },
        ],
      });

    const res = await request(app)
      .get("/api/v1/rides/summary/weekly")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.totalRides).toBe(4);
    expect(res.body.hasRides).toBe(true);
    expect(res.body.cleanestRide.id).toBe("ride-clean");
    expect(res.body.mostPollutedRide.id).toBe("ride-polluted");
    expect(res.body).toHaveProperty("weekStart");
    expect(res.body).toHaveProperty("weekEnd");
  });

  it("returns hasRides: false for user with no rides this week", async () => {
    authAs(FREE_USER);
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            total_rides: "0",
            total_distance_m: null,
            total_duration_seconds: null,
            avg_aqi: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/v1/rides/summary/weekly")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.totalRides).toBe(0);
    expect(res.body.hasRides).toBe(false);
    expect(res.body).not.toHaveProperty("avgAqi");
  });
});

// ── GET /api/v1/rides/best-time ───────────────────────────────────────────────

describe("GET /api/v1/rides/best-time", () => {
  it("returns 400 when home_location is not set", async () => {
    authAs(FREE_USER_NO_HOME);

    const res = await request(app)
      .get("/api/v1/rides/best-time")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/home location/i);
  });

  it("returns recommendation: good when AQI is 0-50", async () => {
    authAs(FREE_USER_WITH_HOME);
    aqiCache.getAqiForPoint.mockResolvedValueOnce(30);

    const res = await request(app)
      .get("/api/v1/rides/best-time")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBe("good");
    expect(res.body.currentAqi).toBe(30);
  });

  it("returns recommendation: postpone when AQI is 101+", async () => {
    authAs(FREE_USER_WITH_HOME);
    aqiCache.getAqiForPoint.mockResolvedValueOnce(150);

    const res = await request(app)
      .get("/api/v1/rides/best-time")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.recommendation).toBe("postpone");
  });
});
