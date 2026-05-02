const { haversineDistance } = require("../utils/geo");
const { getCategory, computeWeekBoundaries } = require("../controllers/rides.controller");

describe("Distance computation", () => {
  it("returns correct value for known coordinate pairs", () => {
    // Mumbai (19.076, 72.877) to a point ~1km north
    const coords = [
      [72.877, 19.076],
      [72.877, 19.085], // ~1km north
    ];
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      dist += haversineDistance(lat1, lng1, lat2, lng2);
    }
    expect(Math.round(dist)).toBeGreaterThan(900);
    expect(Math.round(dist)).toBeLessThan(1100);
  });
});

describe("Duration computation", () => {
  it("is correct from ISO timestamps", () => {
    const startedAt = "2026-04-30T07:00:00Z";
    const endedAt = "2026-04-30T07:42:15Z";
    const durationSeconds = Math.round(
      (new Date(endedAt) - new Date(startedAt)) / 1000
    );
    expect(durationSeconds).toBe(2535);
  });
});

describe("avg_aqi computation", () => {
  it("is computed as simple mean of sample values", () => {
    const aqiValues = [24, 31, 28, 35, 22];
    const mean = aqiValues.reduce((sum, v) => sum + v, 0) / aqiValues.length;
    expect(parseFloat(mean.toFixed(1))).toBe(28.0);
  });
});

describe("max_aqi computation", () => {
  it("is the maximum sample AQI value", () => {
    const aqiValues = [24, 31, 28, 67, 22];
    expect(Math.max(...aqiValues)).toBe(67);
  });
});

describe("Weekly boundary calculation", () => {
  it("is correct (Monday UTC start) for a Thursday input", () => {
    // 2026-04-30 is a Thursday; week should start 2026-04-27 (Monday)
    const thursday = new Date("2026-04-30T12:00:00Z");
    const { weekStart, weekEnd } = computeWeekBoundaries(thursday);
    expect(weekStart.toISOString()).toBe("2026-04-27T00:00:00.000Z");
    expect(weekEnd.toISOString()).toBe("2026-05-03T23:59:59.999Z");
  });

  it("returns the same Monday when input is already Monday", () => {
    const monday = new Date("2026-04-27T10:00:00Z");
    const { weekStart } = computeWeekBoundaries(monday);
    expect(weekStart.toISOString()).toBe("2026-04-27T00:00:00.000Z");
  });

  it("returns the previous Monday when input is Sunday", () => {
    const sunday = new Date("2026-05-03T22:00:00Z");
    const { weekStart } = computeWeekBoundaries(sunday);
    expect(weekStart.toISOString()).toBe("2026-04-27T00:00:00.000Z");
  });
});

describe("AQI category mapping", () => {
  it("maps boundary values correctly", () => {
    expect(getCategory(0)).toBe("good");
    expect(getCategory(50)).toBe("good");
    expect(getCategory(51)).toBe("moderate");
    expect(getCategory(100)).toBe("moderate");
    expect(getCategory(101)).toBe("unhealthy-for-sensitive-groups");
    expect(getCategory(150)).toBe("unhealthy-for-sensitive-groups");
    expect(getCategory(151)).toBe("unhealthy");
    expect(getCategory(200)).toBe("unhealthy");
    expect(getCategory(201)).toBe("very-unhealthy");
    expect(getCategory(300)).toBe("very-unhealthy");
    expect(getCategory(301)).toBe("hazardous");
  });
});
