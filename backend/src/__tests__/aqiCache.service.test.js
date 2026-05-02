jest.mock("../db/redis", () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../services/waqi");
jest.mock("../utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { redis } = require("../db/redis");
const { pool } = require("../db/connection");
const waqi = require("../services/waqi");
const {
  getAqiForPoint,
  getAqiForBounds,
  getForecastForPoint,
  invalidatePoint,
} = require("../services/aqiCache");
const { NoForecastAvailableError } = require("../utils/errors");

const MOCK_READING = {
  aqi: 85,
  station: { id: "waqi:1", name: "Test", lat: 19.076, lng: 72.877 },
  dominantPollutant: "pm25",
  pollutants: { pm25: 42 },
  category: "moderate",
  recordedAt: "2026-04-30T14:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

describe("getAqiForPoint", () => {
  it("returns cached value on Redis HIT without calling WAQI", async () => {
    redis.get.mockResolvedValue(JSON.stringify(MOCK_READING));

    const result = await getAqiForPoint(19.076, 72.877);

    expect(waqi.getAqiByCoordinates).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.aqi).toBe(85);
  });

  it("calls WAQI and caches result on Redis MISS", async () => {
    redis.get.mockResolvedValue(null);
    redis.setex.mockResolvedValue("OK");
    waqi.getAqiByCoordinates.mockResolvedValue({ ...MOCK_READING });

    const result = await getAqiForPoint(19.076, 72.877);

    expect(waqi.getAqiByCoordinates).toHaveBeenCalledWith(19.076, 72.877);
    expect(redis.setex).toHaveBeenCalled();
    expect(result.cached).toBe(false);
  });

  it("falls through to WAQI without throwing when Redis is unavailable", async () => {
    redis.get.mockRejectedValue(new Error("Redis down"));
    waqi.getAqiByCoordinates.mockResolvedValue({ ...MOCK_READING });

    const result = await getAqiForPoint(19.076, 72.877);

    expect(waqi.getAqiByCoordinates).toHaveBeenCalled();
    expect(result.aqi).toBe(85);
  });

  it("persists to aqi_history fire-and-forget after cache miss", async () => {
    redis.get.mockResolvedValue(null);
    redis.setex.mockResolvedValue("OK");
    waqi.getAqiByCoordinates.mockResolvedValue({ ...MOCK_READING });

    await getAqiForPoint(19.076, 72.877);

    // fire-and-forget — give the microtask a tick to schedule
    await Promise.resolve();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO aqi_history"),
      expect.any(Array)
    );
  });
});

describe("getForecastForPoint", () => {
  it("does not cache when NoForecastAvailableError is thrown", async () => {
    redis.get.mockResolvedValue(null);
    waqi.getForecast.mockRejectedValue(new NoForecastAvailableError("No forecast"));

    await expect(getForecastForPoint(19.076, 72.877)).rejects.toThrow(
      NoForecastAvailableError
    );
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it("returns cached forecast on HIT", async () => {
    const mockForecast = { daily: { pm25: [] } };
    redis.get.mockResolvedValue(JSON.stringify(mockForecast));

    const result = await getForecastForPoint(19.076, 72.877);

    expect(waqi.getForecast).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
  });
});

describe("getAqiForBounds", () => {
  it("returns cached stations on HIT", async () => {
    redis.get.mockResolvedValue(JSON.stringify([MOCK_READING]));

    const { stations, cached } = await getAqiForBounds(18, 72, 20, 74);

    expect(waqi.getAqiByBounds).not.toHaveBeenCalled();
    expect(cached).toBe(true);
    expect(stations).toHaveLength(1);
  });

  it("calls WAQI on MISS and caches result", async () => {
    redis.get.mockResolvedValue(null);
    redis.setex.mockResolvedValue("OK");
    waqi.getAqiByBounds.mockResolvedValue([MOCK_READING]);

    const { stations, cached } = await getAqiForBounds(18, 72, 20, 74);

    expect(waqi.getAqiByBounds).toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalled();
    expect(cached).toBe(false);
    expect(stations).toHaveLength(1);
  });
});

describe("invalidatePoint", () => {
  it("deletes the cache key for the coordinate", async () => {
    redis.del.mockResolvedValue(1);

    await invalidatePoint(19.076, 72.877);

    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining("aqi:point:"));
  });
});
