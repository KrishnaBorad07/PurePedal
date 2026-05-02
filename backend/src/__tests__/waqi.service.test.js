const nock = require("nock");
const { getAqiByCoordinates, getAqiByBounds, getForecast } = require("../services/waqi");
const { WaqiApiError, StationTooFarError, NoForecastAvailableError } = require("../utils/errors");

const TOKEN = process.env.WAQI_API_TOKEN || "test-token";
const BASE = "https://api.waqi.info";

const NEARBY_STATION = {
  status: "ok",
  data: {
    aqi: 85,
    idx: 1234,
    dominentpol: "pm25",
    city: { name: "Test Station", geo: [19.076, 72.877] },
    iaqi: { pm25: { v: 42.3 }, pm10: { v: 67.1 }, o3: { v: 18.2 } },
    time: { iso: "2026-04-30T14:00:00Z" },
    forecast: null,
  },
};

const FAR_STATION = {
  status: "ok",
  data: {
    aqi: 50,
    idx: 9999,
    dominentpol: "o3",
    city: { name: "Far Station", geo: [25.0, 85.0] },
    iaqi: { o3: { v: 30 } },
    time: { iso: "2026-04-30T14:00:00Z" },
  },
};

afterEach(() => {
  nock.cleanAll();
});

describe("getAqiByCoordinates", () => {
  it("returns normalized reading on valid WAQI response", async () => {
    nock(BASE)
      .get(/\/feed\/geo:19\.076;72\.877/)
      .reply(200, NEARBY_STATION);

    const result = await getAqiByCoordinates(19.076, 72.877);

    expect(result.aqi).toBe(85);
    expect(result.station.id).toBe("waqi:1234");
    expect(result.station.name).toBe("Test Station");
    expect(result.dominantPollutant).toBe("pm25");
    expect(result.pollutants.pm25).toBe(42.3);
    expect(result.category).toBe("moderate");
    expect(result.recordedAt).toBe("2026-04-30T14:00:00Z");
  });

  it("throws StationTooFarError when station is > 50km away", async () => {
    nock(BASE)
      .get(/\/feed\/geo:19\.076;72\.877/)
      .reply(200, FAR_STATION);

    await expect(getAqiByCoordinates(19.076, 72.877)).rejects.toThrow(
      StationTooFarError
    );
  });

  it("throws WaqiApiError on non-ok WAQI status", async () => {
    nock(BASE)
      .get(/\/feed\/geo:/)
      .reply(200, { status: "error", data: "Unknown station" });

    await expect(getAqiByCoordinates(0, 0)).rejects.toThrow(WaqiApiError);
  });

  it("throws WaqiApiError on HTTP failure", async () => {
    nock(BASE).get(/\/feed\/geo:/).replyWithError("Network error");

    await expect(getAqiByCoordinates(19.076, 72.877)).rejects.toThrow(
      WaqiApiError
    );
  });
});

describe("getAqiByBounds", () => {
  it("returns array of normalized stations", async () => {
    nock(BASE)
      .get(/\/map\/bounds/)
      .reply(200, {
        status: "ok",
        data: [
          {
            aqi: 72,
            idx: 1,
            dominentpol: "pm10",
            city: { name: "Station A", geo: [19.1, 72.9] },
            iaqi: { pm10: { v: 50 } },
            time: { iso: "2026-04-30T12:00:00Z" },
          },
        ],
      });

    const result = await getAqiByBounds(18, 72, 20, 74);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].aqi).toBe(72);
    expect(result[0].station.id).toBe("waqi:1");
  });

  it("throws WaqiApiError on non-ok status", async () => {
    nock(BASE)
      .get(/\/map\/bounds/)
      .reply(200, { status: "error" });

    await expect(getAqiByBounds(18, 72, 20, 74)).rejects.toThrow(WaqiApiError);
  });
});

describe("category mapping", () => {
  const categories = [
    [0, "good"],
    [50, "good"],
    [51, "moderate"],
    [100, "moderate"],
    [101, "unhealthy-for-sensitive-groups"],
    [150, "unhealthy-for-sensitive-groups"],
    [151, "unhealthy"],
    [200, "unhealthy"],
    [201, "very-unhealthy"],
    [300, "very-unhealthy"],
    [301, "hazardous"],
    [500, "hazardous"],
  ];

  test.each(categories)("AQI %i → %s", async (aqi, expectedCategory) => {
    nock(BASE)
      .get(/\/feed\/geo:/)
      .reply(200, {
        status: "ok",
        data: {
          aqi,
          idx: 1,
          dominentpol: "pm25",
          city: { name: "Test", geo: [0, 0] },
          iaqi: {},
          time: { iso: "2026-04-30T00:00:00Z" },
        },
      });

    const result = await getAqiByCoordinates(0, 0);
    expect(result.category).toBe(expectedCategory);
  });
});

describe("getForecast", () => {
  it("throws NoForecastAvailableError when forecast is absent", async () => {
    nock(BASE)
      .get(/\/feed\/geo:/)
      .reply(200, NEARBY_STATION);

    await expect(getForecast(19.076, 72.877)).rejects.toThrow(
      NoForecastAvailableError
    );
  });

  it("returns forecast object when present", async () => {
    const withForecast = {
      ...NEARBY_STATION,
      data: {
        ...NEARBY_STATION.data,
        forecast: { daily: { pm25: [{ day: "2026-04-30", avg: 60, min: 40, max: 80 }] } },
      },
    };
    nock(BASE).get(/\/feed\/geo:/).reply(200, withForecast);

    const result = await getForecast(19.076, 72.877);
    expect(result.daily.pm25).toHaveLength(1);
  });
});
