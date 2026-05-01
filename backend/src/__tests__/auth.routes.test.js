jest.mock("../utils/supabase", () => ({
  anonClient: {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
    },
  },
  adminClient: {
    auth: {
      getUser: jest.fn(),
      admin: { signOut: jest.fn() },
    },
  },
}));

jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

const express = require("express");
const request = require("supertest");
const { anonClient, adminClient } = require("../utils/supabase");
const { pool } = require("../db/connection");
const authRouter = require("../routes/auth");

const app = express();
app.use(express.json());
app.use(authRouter);

const mockUser = {
  id: "user-uuid",
  email: "test@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "free",
  subscription_expires_at: null,
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/v1/auth/signup", () => {
  test("returns 400 for invalid email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "notanemail", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("returns 400 for short password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "test@example.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /api/v1/auth/login", () => {
  test("returns 401 for wrong credentials", async () => {
    anonClient.auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials", status: 400 },
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /api/v1/auth/logout", () => {
  test("returns 401 without token", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(401);
  });

  test("returns 200 with valid token", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid", email: "test@example.com" } },
      error: null,
    });

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", "Bearer validtoken");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
  });
});

describe("GET /api/v1/me", () => {
  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
  });

  test("returns 200 with valid token", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid", email: "test@example.com" } },
      error: null,
    });
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [mockUser] });

    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer validtoken");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id", "user-uuid");
  });
});

describe("PATCH /api/v1/me", () => {
  test("returns 400 for invalid lat", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid", email: "test@example.com" } },
      error: null,
    });
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [mockUser] });

    const res = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", "Bearer validtoken")
      .send({ home_location: { lat: 999, lng: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat/);
  });

  test("returns 200 with updated display_name", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid", email: "test@example.com" } },
      error: null,
    });
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({
        rows: [{ ...mockUser, display_name: "Krishna" }],
      });

    const res = await request(app)
      .patch("/api/v1/me")
      .set("Authorization", "Bearer validtoken")
      .send({ display_name: "Krishna" });
    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe("Krishna");
  });
});
