jest.mock("../db/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../services/ors");

jest.mock("../utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { redis } = require("../db/redis");
const ors = require("../services/ors");
const { getRoutes, invalidateRoutes } = require("../services/routeCache");

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
    instructions: [],
    bbox: [],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getRoutes", () => {
  it("returns cached routes on Redis HIT without calling ORS", async () => {
    redis.get.mockResolvedValue(JSON.stringify(MOCK_ROUTES));

    const result = await getRoutes(ORIGIN, DESTINATION);

    expect(ors.getCyclingRoutes).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].id).toBe("ors:0");
  });

  it("calls ORS and caches the result on Redis MISS", async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");
    ors.getCyclingRoutes.mockResolvedValue(MOCK_ROUTES);

    const result = await getRoutes(ORIGIN, DESTINATION);

    expect(ors.getCyclingRoutes).toHaveBeenCalledWith(ORIGIN, DESTINATION);
    expect(redis.set).toHaveBeenCalled();
    expect(result.cached).toBe(false);
    expect(result.routes).toEqual(MOCK_ROUTES);
  });

  it("falls through to ORS without throwing when Redis is unavailable", async () => {
    redis.get.mockRejectedValue(new Error("Redis connection refused"));
    ors.getCyclingRoutes.mockResolvedValue(MOCK_ROUTES);

    const result = await getRoutes(ORIGIN, DESTINATION);

    expect(ors.getCyclingRoutes).toHaveBeenCalled();
    expect(result.cached).toBe(false);
    expect(result.routes).toEqual(MOCK_ROUTES);
  });
});

describe("invalidateRoutes", () => {
  it("deletes the cache key for the given origin and destination", async () => {
    redis.del.mockResolvedValue(1);

    await invalidateRoutes(ORIGIN, DESTINATION);

    expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/^route:/));
  });
});
