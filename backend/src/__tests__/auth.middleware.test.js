jest.mock("../utils/supabase", () => ({
  adminClient: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const { adminClient } = require("../utils/supabase");
const { requireAuth } = require("../middleware/auth");

function mockReqRes(headers = {}) {
  const req = { headers };
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

describe("requireAuth middleware", () => {
  test("returns 401 when Authorization header is missing", async () => {
    const { req, res, next } = mockReqRes({});
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when header is malformed (not Bearer)", async () => {
    const { req, res, next } = mockReqRes({ authorization: "Basic abc123" });
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when token is invalid", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid JWT" },
    });

    const { req, res, next } = mockReqRes({ authorization: "Bearer badtoken" });
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token." });
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() and sets req.user when token is valid", async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid", email: "test@example.com" } },
      error: null,
    });

    const { req, res, next } = mockReqRes({
      authorization: "Bearer validtoken",
    });
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: "user-uuid", email: "test@example.com" });
    expect(res.status).not.toHaveBeenCalled();
  });
});
