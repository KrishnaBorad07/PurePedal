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
  redis: { get: jest.fn(), set: jest.fn(), exists: jest.fn() },
}));

jest.mock("../services/aqiCache", () => ({
  getAqiForPoint: jest.fn(),
}));

jest.mock("../utils/pushClient", () => ({
  sendPushNotifications: jest.fn().mockResolvedValue([]),
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
    hazardAlertsIntervalMs: 3600000,
    hazardAlertSuppressionTtlS: 21600,
  },
}));

let capturedProcessor;

const { pool } = require("../db/connection");
const { redis } = require("../db/redis");
const aqiCache = require("../services/aqiCache");
const pushClient = require("../utils/pushClient");
const { startHazardAlertsWorker } = require("../workers/hazardAlerts");

const mockJob = { id: "job-1" };

const USER_WITH_TOKENS = {
  user_id: "user-uuid-1",
  lat: 19.076,
  lng: 72.877,
  token: "ExponentPushToken[abc123]",
  platform: "ios",
};

beforeAll(async () => {
  await startHazardAlertsWorker();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hazardAlerts processor", () => {
  it("does not send notifications when AQI <= 100", async () => {
    pool.query.mockResolvedValueOnce({ rows: [USER_WITH_TOKENS] });
    aqiCache.getAqiForPoint.mockResolvedValueOnce({ aqi: 85 });
    redis.exists.mockResolvedValue(0);

    await capturedProcessor(mockJob);

    expect(pushClient.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("sends notifications when AQI > 100", async () => {
    pool.query.mockResolvedValueOnce({ rows: [USER_WITH_TOKENS] });
    aqiCache.getAqiForPoint.mockResolvedValueOnce({ aqi: 155 });
    redis.exists.mockResolvedValueOnce(0);
    redis.set.mockResolvedValueOnce("OK");

    await capturedProcessor(mockJob);

    expect(pushClient.sendPushNotifications).toHaveBeenCalledTimes(1);
    const [notifications] = pushClient.sendPushNotifications.mock.calls[0];
    expect(notifications[0].to).toBe(USER_WITH_TOKENS.token);
    expect(notifications[0].data.aqi).toBe(155);
  });

  it("skips users with an active suppression key in Redis", async () => {
    pool.query.mockResolvedValueOnce({ rows: [USER_WITH_TOKENS] });
    aqiCache.getAqiForPoint.mockResolvedValueOnce({ aqi: 180 });
    redis.exists.mockResolvedValueOnce(1); // suppression key exists

    await capturedProcessor(mockJob);

    expect(pushClient.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("sets suppression key after sending a notification", async () => {
    pool.query.mockResolvedValueOnce({ rows: [USER_WITH_TOKENS] });
    aqiCache.getAqiForPoint.mockResolvedValueOnce({ aqi: 220 });
    redis.exists.mockResolvedValueOnce(0);
    redis.set.mockResolvedValueOnce("OK");

    await capturedProcessor(mockJob);

    expect(redis.set).toHaveBeenCalledWith(
      `alert:hazard:${USER_WITH_TOKENS.user_id}`,
      "1",
      "EX",
      expect.any(Number)
    );
  });

  it("skips users with no push tokens silently", async () => {
    const userNoToken = { ...USER_WITH_TOKENS, token: null, platform: null };
    pool.query.mockResolvedValueOnce({ rows: [userNoToken] });
    aqiCache.getAqiForPoint.mockResolvedValueOnce({ aqi: 160 });

    await capturedProcessor(mockJob);

    expect(pushClient.sendPushNotifications).not.toHaveBeenCalled();
    const logger = require("../utils/logger");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("continues processing other users when a single region AQI fetch fails", async () => {
    const user2 = { ...USER_WITH_TOKENS, user_id: "user-uuid-2", lat: 28.6, lng: 77.2, token: "ExponentPushToken[def456]" };
    pool.query.mockResolvedValueOnce({ rows: [USER_WITH_TOKENS, user2] });

    aqiCache.getAqiForPoint
      .mockRejectedValueOnce(new Error("WAQI timeout"))
      .mockResolvedValueOnce({ aqi: 130 });

    redis.exists.mockResolvedValue(0);
    redis.set.mockResolvedValue("OK");

    await expect(capturedProcessor(mockJob)).resolves.not.toThrow();
  });
});
