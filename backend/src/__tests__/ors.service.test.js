const nock = require("nock");
const { getCyclingRoutes } = require("../services/ors");
const { OrsApiError, OrsNoRouteError } = require("../utils/errors");

const BASE = "https://api.openrouteservice.org";

const ORIGIN = { lat: 19.076, lng: 72.877 };
const DESTINATION = { lat: 19.113, lng: 72.869 };

function makeOrsRoute(idx, distance, duration, ascent = 10, descent = 5) {
  return {
    summary: { distance, duration, ascent, descent },
    geometry: "}}}~FwcmtO??",
    segments: [
      {
        steps: [
          { instruction: "Head north", distance: 100, duration: 30 },
          { instruction: "Turn left", distance: 200, duration: 50 },
        ],
      },
    ],
    bbox: [72.87, 19.07, 72.9, 19.12],
  };
}

const ORS_RESPONSE_THREE = {
  routes: [
    makeOrsRoute(0, 5200, 1080),
    makeOrsRoute(1, 6100, 900),
    makeOrsRoute(2, 4800, 1200),
  ],
};

const ORS_RESPONSE_ONE = {
  routes: [makeOrsRoute(0, 5200, 1080)],
};

afterEach(() => {
  nock.cleanAll();
});

describe("getCyclingRoutes", () => {
  it("returns normalized route objects for a valid ORS response", async () => {
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .reply(200, ORS_RESPONSE_THREE);

    const routes = await getCyclingRoutes(ORIGIN, DESTINATION);

    expect(Array.isArray(routes)).toBe(true);
    expect(routes).toHaveLength(3);

    const [r0] = routes;
    expect(r0.id).toBe("ors:0");
    expect(r0.geometry.type).toBe("LineString");
    expect(Array.isArray(r0.geometry.coordinates)).toBe(true);
    expect(r0.distance_m).toBe(5200);
    expect(r0.duration_s).toBe(1080);
    expect(r0.elevation_gain_m).toBe(10);
    expect(r0.elevation_loss_m).toBe(5);
    expect(r0.instructions).toHaveLength(2);
    expect(r0.instructions[0].text).toBe("Head north");
  });

  it("sends coordinates as [lng, lat] to ORS (not [lat, lng])", async () => {
    let capturedBody;
    nock(BASE)
      .post("/v2/directions/cycling-regular", (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, ORS_RESPONSE_ONE);

    await getCyclingRoutes(ORIGIN, DESTINATION);

    expect(capturedBody.coordinates[0]).toEqual([ORIGIN.lng, ORIGIN.lat]);
    expect(capturedBody.coordinates[1]).toEqual([DESTINATION.lng, DESTINATION.lat]);
  });

  it("assigns 'recommended' to index 0, 'alternative' to index 1 by default", async () => {
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .reply(200, ORS_RESPONSE_THREE);

    const routes = await getCyclingRoutes(ORIGIN, DESTINATION);
    expect(routes[0].type).toBe("recommended");
    expect(routes[1].type).toBe("fastest"); // index 1 has duration 900 — lowest
    expect(routes[2].type).toBe("alternative");
  });

  it("re-assigns 'fastest' to the route with lowest duration_s", async () => {
    // index 1 has duration 900 which is lowest — should get 'fastest'
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .reply(200, ORS_RESPONSE_THREE);

    const routes = await getCyclingRoutes(ORIGIN, DESTINATION);
    const fastestRoute = routes.find((r) => r.type === "fastest");
    const lowestDuration = Math.min(...routes.map((r) => r.duration_s));
    expect(fastestRoute.duration_s).toBe(lowestDuration);
  });

  it("throws OrsNoRouteError when ORS returns empty routes array", async () => {
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .reply(200, { routes: [] });

    await expect(getCyclingRoutes(ORIGIN, DESTINATION)).rejects.toThrow(OrsNoRouteError);
  });

  it("throws OrsApiError on non-2xx ORS response", async () => {
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .reply(500, { error: "Internal Server Error" });

    await expect(getCyclingRoutes(ORIGIN, DESTINATION)).rejects.toThrow(OrsApiError);
  });

  it("throws OrsApiError on request timeout", async () => {
    nock(BASE)
      .post("/v2/directions/cycling-regular")
      .replyWithError({ code: "ECONNABORTED", message: "timeout of 10000ms exceeded" });

    await expect(getCyclingRoutes(ORIGIN, DESTINATION)).rejects.toThrow(OrsApiError);
  });
});
