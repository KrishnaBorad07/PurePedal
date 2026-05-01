jest.mock("../db/connection", () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require("../db/connection");
const { syncUser } = require("../middleware/syncUser");

const mockUser = {
  id: "test-uuid",
  email: "test@example.com",
  display_name: null,
  home_location: null,
  subscription_status: "free",
  subscription_expires_at: null,
  scoring_weights: { aqi: 0.6, distance: 0.25, elevation: 0.15 },
  created_at: new Date().toISOString(),
};

function mockReqRes() {
  const req = { user: { id: "test-uuid", email: "test@example.com" } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("syncUser middleware", () => {
  test("inserts new user and sets req.dbUser", async () => {
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [mockUser] });

    const { req, res, next } = mockReqRes();
    await syncUser(req, res, next);

    expect(pool.query).toHaveBeenCalledTimes(2);
    const insertCall = pool.query.mock.calls[0];
    expect(insertCall[0]).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(req.dbUser).toEqual(mockUser);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("does not error when user already exists (ON CONFLICT DO NOTHING)", async () => {
    pool.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [mockUser] });

    const { req, res, next } = mockReqRes();
    await syncUser(req, res, next);

    expect(req.dbUser).toEqual(mockUser);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("returns 500 on database error", async () => {
    pool.query.mockRejectedValueOnce(new Error("DB connection failed"));

    const { req, res, next } = mockReqRes();
    await syncUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error." });
    expect(next).not.toHaveBeenCalled();
  });
});
