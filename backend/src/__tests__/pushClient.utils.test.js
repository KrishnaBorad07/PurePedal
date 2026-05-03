jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../config", () => ({
  expo: { pushUrl: "https://exp.host/--/api/v2/push/send" },
}));

const logger = require("../utils/logger");

// Mock global fetch
global.fetch = jest.fn();

const { sendPushNotifications, sendPushNotification } = require("../utils/pushClient");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("sendPushNotifications", () => {
  it("sends a single batch when notifications <= 100", async () => {
    const notifications = Array.from({ length: 5 }, (_, i) => ({
      to: `ExponentPushToken[token${i}]`,
      title: "Test",
      body: "Body",
      data: {},
    }));

    fetch.mockResolvedValueOnce({
      json: async () => ({ data: notifications.map(() => ({ status: "ok", id: `ticket-${Math.random()}` })) }),
    });

    const tickets = await sendPushNotifications(notifications);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tickets).toHaveLength(5);
  });

  it("chunks notifications into groups of 100", async () => {
    const notifications = Array.from({ length: 250 }, (_, i) => ({
      to: `ExponentPushToken[token${i}]`,
      title: "Test",
      body: "Body",
      data: {},
    }));

    const makeBatchResponse = (size) => ({
      json: async () => ({
        data: Array.from({ length: size }, () => ({ status: "ok", id: "t" })),
      }),
    });

    fetch
      .mockResolvedValueOnce(makeBatchResponse(100))
      .mockResolvedValueOnce(makeBatchResponse(100))
      .mockResolvedValueOnce(makeBatchResponse(50));

    const tickets = await sendPushNotifications(notifications);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(tickets).toHaveLength(250);
  });

  it("logs error tickets without throwing", async () => {
    const notifications = [{ to: "ExponentPushToken[abc]", title: "T", body: "B", data: {} }];

    fetch.mockResolvedValueOnce({
      json: async () => ({
        data: [{ status: "error", message: "DeviceNotRegistered", details: { error: "DeviceNotRegistered" } }],
      }),
    });

    await expect(sendPushNotifications(notifications)).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: expect.objectContaining({ status: "error" }) }),
      expect.any(String)
    );
  });

  it("logs error and continues on fetch failure without throwing", async () => {
    const notifications = [{ to: "ExponentPushToken[abc]", title: "T", body: "B", data: {} }];

    fetch.mockRejectedValueOnce(new Error("Network error"));

    const tickets = await sendPushNotifications(notifications);
    expect(tickets).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns an empty array for an empty input", async () => {
    const tickets = await sendPushNotifications([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(tickets).toHaveLength(0);
  });
});

describe("sendPushNotification", () => {
  it("calls sendPushNotifications with a single notification", async () => {
    fetch.mockResolvedValueOnce({
      json: async () => ({ data: [{ status: "ok", id: "t1" }] }),
    });

    const tickets = await sendPushNotification(
      "ExponentPushToken[abc]",
      "Title",
      "Body",
      { type: "test" }
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toHaveLength(1);
    expect(body[0].to).toBe("ExponentPushToken[abc]");
    expect(body[0].title).toBe("Title");
    expect(tickets).toHaveLength(1);
  });
});
