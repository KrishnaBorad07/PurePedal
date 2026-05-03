jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

jest.mock("../config", () => ({
  revenuecat: { webhookSecret: "test-webhook-secret" },
}));

const express = require("express");
const request = require("supertest");
const { pool } = require("../db/connection");
const webhooksRouter = require("../routes/webhooks");

const app = express();
// Mount WITHOUT global express.json() to mirror the real index.js mount
app.use("/webhooks", webhooksRouter);

const VALID_PURCHASE_PAYLOAD = {
  api_version: "1.0",
  event: {
    type: "INITIAL_PURCHASE",
    id: "evt-001",
    app_user_id: "user-uuid-abc",
    expiration_at_ms: 1800000000000,
    store: "APP_STORE",
    environment: "PRODUCTION",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [{ id: "user-uuid-abc" }] });
});

describe("POST /webhooks/revenuecat", () => {
  test("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/webhooks/revenuecat")
      .send(VALID_PURCHASE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  test("returns 401 with wrong secret", async () => {
    const res = await request(app)
      .post("/webhooks/revenuecat")
      .set("Authorization", "Bearer wrong-secret")
      .send(VALID_PURCHASE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  test("returns 200 for INITIAL_PURCHASE with valid secret", async () => {
    const res = await request(app)
      .post("/webhooks/revenuecat")
      .set("Authorization", "Bearer test-webhook-secret")
      .send(VALID_PURCHASE_PAYLOAD);
    expect(res.status).toBe(200);
  });

  test("returns 200 for unknown event type with valid secret", async () => {
    const res = await request(app)
      .post("/webhooks/revenuecat")
      .set("Authorization", "Bearer test-webhook-secret")
      .send({
        api_version: "1.0",
        event: {
          type: "SUBSCRIBER_ALIAS",
          app_user_id: "user-uuid-abc",
        },
      });
    expect(res.status).toBe(200);
  });

  test("returns 200 for unknown app_user_id with valid secret", async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes("SELECT id FROM users")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post("/webhooks/revenuecat")
      .set("Authorization", "Bearer test-webhook-secret")
      .send({
        api_version: "1.0",
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "non-existent-user",
          expiration_at_ms: 1800000000000,
        },
      });
    expect(res.status).toBe(200);
  });
});
