jest.mock("../config", () => ({
  revenuecat: { webhookSecret: "test-secret-abc" },
}));

const { verifyRevenueCat } = require("../middleware/verifyRevenueCat");

function makeReqRes(authHeader) {
  const req = { headers: authHeader ? { authorization: authHeader } : {} };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("verifyRevenueCat middleware", () => {
  test("returns 401 when Authorization header is missing", () => {
    const { req, res, next } = makeReqRes(undefined);
    verifyRevenueCat(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when header is not Bearer scheme", () => {
    const { req, res, next } = makeReqRes("Basic dXNlcjpwYXNz");
    verifyRevenueCat(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when token does not match configured secret", () => {
    const { req, res, next } = makeReqRes("Bearer wrong-secret");
    verifyRevenueCat(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() when token matches configured secret", () => {
    const { req, res, next } = makeReqRes("Bearer test-secret-abc");
    verifyRevenueCat(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
