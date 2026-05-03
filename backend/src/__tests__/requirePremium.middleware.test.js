const { requirePremium } = require("../middleware/requirePremium");

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe("requirePremium middleware", () => {
  test("throws when req.dbUser is undefined", () => {
    const req = {};
    expect(() => requirePremium(req, makeRes(), jest.fn())).toThrow(
      "requirePremium must be called after syncUser",
    );
  });

  test("returns 403 with upgradeRequired for free user", () => {
    const req = { dbUser: { subscription_status: "free", subscription_expires_at: null } };
    const res = makeRes();
    const next = jest.fn();
    requirePremium(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 with upgradeRequired for lapsed user", () => {
    const req = { dbUser: { subscription_status: "lapsed", subscription_expires_at: null } };
    const res = makeRes();
    const next = jest.fn();
    requirePremium(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 403 when status is premium but expiry is in the past", () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const req = {
      dbUser: { subscription_status: "premium", subscription_expires_at: pastDate },
    };
    const res = makeRes();
    const next = jest.fn();
    requirePremium(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("calls next() when status is premium and expiry is in the future", () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const req = {
      dbUser: { subscription_status: "premium", subscription_expires_at: futureDate },
    };
    const res = makeRes();
    const next = jest.fn();
    requirePremium(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("calls next() when status is premium and expiry is null", () => {
    const req = { dbUser: { subscription_status: "premium", subscription_expires_at: null } };
    const res = makeRes();
    const next = jest.fn();
    requirePremium(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
