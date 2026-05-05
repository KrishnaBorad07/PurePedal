jest.mock("../db/connection", () => ({ pool: { query: jest.fn() } }));

const { pool } = require("../db/connection");
const { getMonthlyReportData } = require("../services/reportData");

beforeEach(() => jest.clearAllMocks());

const USER_ROW = { id: "user-uuid", email: "test@example.com", display_name: "Test Rider" };

describe("getMonthlyReportData", () => {
  it("returns null when user has no rides in the period", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] }) // user query
      .mockResolvedValueOnce({ rows: [] });          // rides query

    const result = await getMonthlyReportData("user-uuid", 4, 2026);
    expect(result).toBeNull();
  });

  it("weightedAvgAqi is distance-weighted not ride-count-weighted", async () => {
    const rides = [
      { id: "r1", started_at: "2026-04-01T07:00:00Z", distance_m: "1000", duration_seconds: "600", avg_aqi: "10", saved_route_name: null },
      { id: "r2", started_at: "2026-04-10T07:00:00Z", distance_m: "9000", duration_seconds: "3600", avg_aqi: "90", saved_route_name: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: rides });

    const result = await getMonthlyReportData("user-uuid", 4, 2026);

    // weightedAvgAqi = (10*1000 + 90*9000) / (1000+9000) = 820000/10000 = 82
    expect(result.summary.weightedAvgAqi).toBe(82);
    // Simple average would be (10+90)/2 = 50, which is different
    expect(result.summary.weightedAvgAqi).not.toBe(50);
  });

  it("cleanestRide is the ride with the lowest avg_aqi", async () => {
    const rides = [
      { id: "r1", started_at: "2026-04-01T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "60", saved_route_name: null },
      { id: "r2", started_at: "2026-04-10T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "20", saved_route_name: null },
      { id: "r3", started_at: "2026-04-20T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "40", saved_route_name: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: rides });

    const result = await getMonthlyReportData("user-uuid", 4, 2026);

    expect(result.summary.cleanestRide.id).toBe("r2");
    expect(result.summary.cleanestRide.avg_aqi).toBe(20);
  });

  it("mostPollutedRide is the ride with the highest avg_aqi", async () => {
    const rides = [
      { id: "r1", started_at: "2026-04-01T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "60", saved_route_name: null },
      { id: "r2", started_at: "2026-04-10T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "20", saved_route_name: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: rides });

    const result = await getMonthlyReportData("user-uuid", 4, 2026);

    expect(result.summary.mostPollutedRide.id).toBe("r1");
  });

  it("weeklyBreakdown correctly assigns rides to weeks", async () => {
    const rides = [
      { id: "r1", started_at: "2026-04-01T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "30", saved_route_name: null },
      { id: "r2", started_at: "2026-04-05T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "40", saved_route_name: null },
      { id: "r3", started_at: "2026-04-08T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "50", saved_route_name: null },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: rides });

    const result = await getMonthlyReportData("user-uuid", 4, 2026);

    expect(result.weeklyBreakdown.length).toBeGreaterThanOrEqual(2);
    const week1 = result.weeklyBreakdown[0];
    expect(week1.weekNumber).toBe(1);
    expect(week1.rides).toBe(2); // r1 (Apr 1) and r2 (Apr 5) are in week 1 (Apr 1–7)
    const week2 = result.weeklyBreakdown[1];
    expect(week2.weekNumber).toBe(2);
    expect(week2.rides).toBe(1); // r3 (Apr 8) is in week 2
  });

  it("returns correct period label", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [USER_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: "r1", started_at: "2026-04-01T07:00:00Z", distance_m: "5000", duration_seconds: "1800", avg_aqi: "30", saved_route_name: null }] });

    const result = await getMonthlyReportData("user-uuid", 4, 2026);

    expect(result.period.label).toBe("April 2026");
    expect(result.period.month).toBe(4);
    expect(result.period.year).toBe(2026);
  });
});
