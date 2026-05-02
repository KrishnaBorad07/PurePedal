const { scoreRoutes } = require("../services/scoringClient");
const { ScoringServiceError } = require("../utils/errors");

const MOCK_ROUTES = [{ id: "ors:0", distance_m: 5200 }];
const MOCK_WEIGHTS = { aqi: 0.6, distance: 0.25, elevation: 0.15 };
const USER_ID = "user-uuid";

const SCORED_RESPONSE = {
  routes: [
    { id: "ors:0", rank: 1, score: { final: 84.2, aqi: 91, distance: 78.5, elevation: 88 } },
  ],
};

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("scoreRoutes", () => {
  it("returns parsed response body on 2xx from scoring service", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(SCORED_RESPONSE),
    });

    const result = await scoreRoutes(MOCK_ROUTES, MOCK_WEIGHTS, USER_ID);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/score"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result.routes[0].rank).toBe(1);
  });

  it("throws ScoringServiceError (isTimeout=false) on non-2xx response", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({ error: "Service unavailable" }),
    });

    const err = await scoreRoutes(MOCK_ROUTES, MOCK_WEIGHTS, USER_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ScoringServiceError);
    expect(err.isTimeout).toBe(false);
  });

  it("throws ScoringServiceError (isTimeout=true) on request timeout", async () => {
    const abortErr = new DOMException("signal timed out", "AbortError");
    global.fetch.mockRejectedValue(abortErr);

    const err = await scoreRoutes(MOCK_ROUTES, MOCK_WEIGHTS, USER_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ScoringServiceError);
    expect(err.isTimeout).toBe(true);
  });
});
