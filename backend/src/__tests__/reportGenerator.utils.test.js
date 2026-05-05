const { generateMonthlyReport } = require("../utils/reportGenerator");

const BASE_DATA = {
  user: { id: "user-uuid", email: "test@example.com", display_name: "Test Rider" },
  period: {
    month: 4,
    year: 2026,
    label: "April 2026",
    startDate: "2026-04-01T00:00:00.000Z",
    endDate: "2026-05-01T00:00:00.000Z",
  },
  summary: {
    totalRides: 1,
    totalDistance_m: 5000,
    totalDuration_seconds: 1800,
    weightedAvgAqi: 38.5,
    exposureScore: 80.75,
    ratioToWho: 0.77,
    whoComparison: "below_guideline",
    cleanestRide: { id: "r1", started_at: "2026-04-05T07:00:00Z", distance_m: 5000, avg_aqi: 30 },
    mostPollutedRide: { id: "r1", started_at: "2026-04-05T07:00:00Z", distance_m: 5000, avg_aqi: 30 },
  },
  weeklyBreakdown: [
    { weekNumber: 1, startDate: "2026-04-01", endDate: "2026-04-07", rides: 1, totalDistance_m: 5000, avgAqi: 30, rating: "excellent" },
  ],
  rides: [
    { id: "r1", started_at: "2026-04-05T07:00:00Z", distance_m: 5000, duration_seconds: 1800, avg_aqi: 30, aqiCategory: "excellent", savedRouteName: null },
  ],
};

function makeRides(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    started_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T07:00:00Z`,
    distance_m: 5000,
    duration_seconds: 1800,
    avg_aqi: 40,
    aqiCategory: "good",
    savedRouteName: null,
  }));
}

describe("generateMonthlyReport", () => {
  it("returns a Buffer", async () => {
    const buf = await generateMonthlyReport("user-uuid", 4, 2026, BASE_DATA);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it("generated buffer starts with %PDF (valid PDF header)", async () => {
    const buf = await generateMonthlyReport("user-uuid", 4, 2026, BASE_DATA);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("does not throw for a user with exactly 1 ride", async () => {
    const data = { ...BASE_DATA, summary: { ...BASE_DATA.summary, totalRides: 1 }, rides: makeRides(1) };
    await expect(generateMonthlyReport("user-uuid", 4, 2026, data)).resolves.toBeDefined();
  });

  it("does not throw for a user with 31 rides (full month)", async () => {
    const rides = makeRides(31);
    const data = {
      ...BASE_DATA,
      summary: { ...BASE_DATA.summary, totalRides: 31 },
      rides,
      weeklyBreakdown: [
        { weekNumber: 1, startDate: "2026-04-01", endDate: "2026-04-07", rides: 7, totalDistance_m: 35000, avgAqi: 40, rating: "good" },
        { weekNumber: 2, startDate: "2026-04-08", endDate: "2026-04-14", rides: 7, totalDistance_m: 35000, avgAqi: 40, rating: "good" },
        { weekNumber: 3, startDate: "2026-04-15", endDate: "2026-04-21", rides: 7, totalDistance_m: 35000, avgAqi: 40, rating: "good" },
        { weekNumber: 4, startDate: "2026-04-22", endDate: "2026-04-28", rides: 7, totalDistance_m: 35000, avgAqi: 40, rating: "good" },
        { weekNumber: 5, startDate: "2026-04-29", endDate: "2026-04-30", rides: 3, totalDistance_m: 15000, avgAqi: 40, rating: "good" },
      ],
    };
    await expect(generateMonthlyReport("user-uuid", 4, 2026, data)).resolves.toBeDefined();
  });
});
