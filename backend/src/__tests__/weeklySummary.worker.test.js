jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}) })),
  Worker: jest.fn().mockImplementation((name, processor) => {
    capturedProcessor = processor;
    return { on: jest.fn(), close: jest.fn() };
  }),
}));

jest.mock("../workers/connections", () => ({
  createWorkerConnection: jest.fn().mockReturnValue({}),
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../db/redis", () => ({
  redis: { set: jest.fn() },
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../config", () => ({
  redis: { url: "redis://localhost:6379" },
  workers: {
    weeklySummaryCron: "0 20 * * 0",
    weeklySummaryTtlS: 604800,
  },
}));

let capturedProcessor;

const { pool } = require("../db/connection");
const { redis } = require("../db/redis");
const { startWeeklySummaryWorker } = require("../workers/weeklySummary");

const mockJob = { id: "job-1" };

const AGG_ROW = {
  total_rides: "3",
  total_distance_m: "24600",
  total_duration_seconds: "5400",
  avg_aqi: "42.0",
};
const CLEANEST_ROW = { id: "ride-1", started_at: "2026-04-28T07:00:00Z", distance_m: 7200, avg_aqi: "28.5" };
const POLLUTED_ROW = { id: "ride-2", started_at: "2026-04-29T08:00:00Z", distance_m: 9400, avg_aqi: "67.3" };

function mockUserRideQueries() {
  pool.query
    .mockResolvedValueOnce({ rows: [AGG_ROW] })
    .mockResolvedValueOnce({ rows: [CLEANEST_ROW] })
    .mockResolvedValueOnce({ rows: [POLLUTED_ROW] });
}

beforeAll(async () => {
  await startWeeklySummaryWorker();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("weeklySummary processor", () => {
  it("only processes users who have rides in the current week", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }); // no active users

    await capturedProcessor(mockJob);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("processes users with rides and writes to cache", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: "user-abc" }] }); // active users

    mockUserRideQueries();
    redis.set.mockResolvedValueOnce("OK");

    await capturedProcessor(mockJob);

    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("cache key includes userId and weekStart date", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: "user-xyz" }] });

    mockUserRideQueries();
    redis.set.mockResolvedValueOnce("OK");

    await capturedProcessor(mockJob);

    const [key] = redis.set.mock.calls[0];
    expect(key).toMatch(/^weekly-summary:user-xyz:\d{4}-\d{2}-\d{2}$/);
  });

  it("cache TTL is 7 days (604800 seconds)", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: "user-xyz" }] });

    mockUserRideQueries();
    redis.set.mockResolvedValueOnce("OK");

    await capturedProcessor(mockJob);

    const [, , , ttl] = redis.set.mock.calls[0];
    expect(ttl).toBe(604800);
  });

  it("continues processing other users when one fails", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: "user-fail" }, { user_id: "user-ok" }] }) // active users
      .mockRejectedValueOnce(new Error("DB error")) // user-fail agg — rejects the Promise.all
      .mockResolvedValueOnce({ rows: [] })           // user-fail cleanest (consumed but ignored)
      .mockResolvedValueOnce({ rows: [] })           // user-fail polluted (consumed but ignored)
      .mockResolvedValueOnce({ rows: [AGG_ROW] })    // user-ok agg
      .mockResolvedValueOnce({ rows: [CLEANEST_ROW] }) // user-ok cleanest
      .mockResolvedValueOnce({ rows: [POLLUTED_ROW] }); // user-ok polluted

    redis.set.mockResolvedValueOnce("OK");

    await expect(capturedProcessor(mockJob)).resolves.not.toThrow();
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});
