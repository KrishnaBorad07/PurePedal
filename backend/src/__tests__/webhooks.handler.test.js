jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../config", () => ({
  revenuecat: { webhookSecret: "test-secret" },
}));

const { pool } = require("../db/connection");

const USER_ID = "user-uuid-123";
const EXPIRY_MS = 1800000000000;
const EXPIRY_ISO = new Date(EXPIRY_MS).toISOString();

function buildEvent(type, overrides = {}) {
  return {
    type,
    app_user_id: USER_ID,
    expiration_at_ms: EXPIRY_MS,
    ...overrides,
  };
}

// Import the handler by requiring the module and extracting the handler
// via the router stack.
let handler;
beforeAll(() => {
  const router = require("../routes/webhooks");
  // The handler is the last layer on the only route
  const layer = router.stack.find((l) => l.route && l.route.path === "/revenuecat");
  const stack = layer.route.stack;
  handler = stack[stack.length - 1].handle;
});

function makeReqRes(eventType, overrides = {}) {
  const req = { body: { event: buildEvent(eventType, overrides) } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: user found
  pool.query.mockImplementation((sql) => {
    if (sql.includes("SELECT id FROM users")) return Promise.resolve({ rows: [{ id: USER_ID }] });
    return Promise.resolve({ rows: [] });
  });
});

describe("revenueCatWebhookHandler", () => {
  test("INITIAL_PURCHASE sets status to premium with expiry", async () => {
    const { req, res } = makeReqRes("INITIAL_PURCHASE");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("subscription_status = 'premium'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual([EXPIRY_ISO, USER_ID]);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("RENEWAL updates expiry and keeps status premium", async () => {
    const { req, res } = makeReqRes("RENEWAL");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("subscription_status = 'premium'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe(EXPIRY_ISO);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("EXPIRATION sets status to lapsed and clears expiry", async () => {
    const { req, res } = makeReqRes("EXPIRATION");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("subscription_status = 'lapsed'"),
    );
    expect(updateCall).toBeDefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("BILLING_ISSUE sets status to lapsed and clears expiry", async () => {
    const { req, res } = makeReqRes("BILLING_ISSUE");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("subscription_status = 'lapsed'"),
    );
    expect(updateCall).toBeDefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("CANCELLATION does not update the users table", async () => {
    const { req, res } = makeReqRes("CANCELLATION");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("UPDATE users"),
    );
    expect(updateCall).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("unknown event type makes no DB update and returns 200", async () => {
    const { req, res } = makeReqRes("SUBSCRIBER_ALIAS");
    await handler(req, res);

    const updateCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("UPDATE users"),
    );
    expect(updateCall).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("unknown app_user_id returns 200 without throwing", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("SELECT id FROM users")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { req, res } = makeReqRes("INITIAL_PURCHASE");
    await expect(handler(req, res)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("every processed event inserts a row into subscription_events", async () => {
    for (const type of ["INITIAL_PURCHASE", "RENEWAL", "EXPIRATION", "BILLING_ISSUE", "CANCELLATION", "SUBSCRIBER_ALIAS"]) {
      jest.clearAllMocks();
      pool.query.mockImplementation((sql) => {
        if (sql.includes("SELECT id FROM users")) return Promise.resolve({ rows: [{ id: USER_ID }] });
        return Promise.resolve({ rows: [] });
      });

      const { req, res } = makeReqRes(type);
      await handler(req, res);

      const auditCall = pool.query.mock.calls.find(
        ([sql]) => sql.includes("INSERT INTO subscription_events"),
      );
      expect(auditCall).toBeDefined();
    }
  });

  test("every event is audited even when user is not found", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("SELECT id FROM users")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { req, res } = makeReqRes("INITIAL_PURCHASE");
    await handler(req, res);

    const auditCall = pool.query.mock.calls.find(
      ([sql]) => sql.includes("INSERT INTO subscription_events"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][0]).toBeNull(); // user_id is null
  });
});
