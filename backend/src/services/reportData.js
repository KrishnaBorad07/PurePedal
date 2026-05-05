const { pool } = require("../db/connection");

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function aqiCategory(aqi) {
  if (aqi <= 50) return "excellent";
  if (aqi <= 100) return "good";
  if (aqi <= 150) return "fair";
  return "poor";
}

function whoComparison(ratio) {
  if (ratio < 1.0) return "below_guideline";
  if (ratio <= 2.0) return "moderate_concern";
  return "high_concern";
}

function getWeekNumber(date, monthStart) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayOfMonth = Math.floor((date - monthStart) / msPerDay);
  return Math.floor(dayOfMonth / 7) + 1;
}

async function getMonthlyReportData(userId, month, year) {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  const [userResult, ridesResult] = await Promise.all([
    pool.query("SELECT id, email, display_name FROM users WHERE id = $1", [userId]),
    pool.query(
      `SELECT r.id, r.started_at, r.distance_m, r.duration_seconds, r.avg_aqi,
              sr.name AS saved_route_name
       FROM rides r
       LEFT JOIN saved_routes sr ON sr.id = r.saved_route_id
       WHERE r.user_id = $1
         AND r.started_at >= $2
         AND r.started_at < $3
       ORDER BY r.started_at ASC`,
      [userId, startDate.toISOString(), endDate.toISOString()]
    ),
  ]);

  const rides = ridesResult.rows;
  if (rides.length === 0) return null;

  const user = userResult.rows[0];

  let totalDistance = 0;
  let totalDuration = 0;
  let weightedAqiSum = 0;
  let cleanestRide = null;
  let mostPollutedRide = null;

  for (const ride of rides) {
    const dist = parseInt(ride.distance_m) || 0;
    const aqi = parseFloat(ride.avg_aqi);
    totalDistance += dist;
    totalDuration += parseInt(ride.duration_seconds) || 0;
    weightedAqiSum += aqi * dist;
    if (!cleanestRide || aqi < parseFloat(cleanestRide.avg_aqi)) cleanestRide = ride;
    if (!mostPollutedRide || aqi > parseFloat(mostPollutedRide.avg_aqi)) mostPollutedRide = ride;
  }

  const weightedAvgAqi = totalDistance > 0 ? parseFloat((weightedAqiSum / totalDistance).toFixed(2)) : 0;
  const exposureScore = parseFloat(Math.max(0, 100 - weightedAvgAqi / 2).toFixed(2));
  const ratioToWho = parseFloat((weightedAvgAqi / 50).toFixed(2));

  const weekMap = new Map();
  for (const ride of rides) {
    const rideDate = new Date(ride.started_at);
    const wn = getWeekNumber(rideDate, startDate);
    if (!weekMap.has(wn)) {
      const weekStart = new Date(startDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + (wn - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      if (weekEnd >= endDate) weekEnd.setTime(endDate.getTime() - 1);
      weekMap.set(wn, { weekNumber: wn, startDate: weekStart, endDate: weekEnd, rides: [], totalDistance_m: 0, aqiWeightedSum: 0 });
    }
    const wk = weekMap.get(wn);
    wk.rides.push(ride);
    const dist = parseInt(ride.distance_m) || 0;
    wk.totalDistance_m += dist;
    wk.aqiWeightedSum += parseFloat(ride.avg_aqi) * dist;
  }

  const weeklyBreakdown = Array.from(weekMap.values())
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((wk) => {
      const avgAqi = wk.totalDistance_m > 0
        ? parseFloat((wk.aqiWeightedSum / wk.totalDistance_m).toFixed(1))
        : 0;
      return {
        weekNumber: wk.weekNumber,
        startDate: wk.startDate.toISOString().slice(0, 10),
        endDate: wk.endDate.toISOString().slice(0, 10),
        rides: wk.rides.length,
        totalDistance_m: wk.totalDistance_m,
        avgAqi,
        rating: aqiCategory(avgAqi),
      };
    });

  const enrichedRides = rides.map((r) => ({
    id: r.id,
    started_at: r.started_at,
    distance_m: parseInt(r.distance_m) || 0,
    duration_seconds: parseInt(r.duration_seconds) || 0,
    avg_aqi: parseFloat(r.avg_aqi),
    aqiCategory: aqiCategory(parseFloat(r.avg_aqi)),
    savedRouteName: r.saved_route_name || null,
  }));

  return {
    user: { id: user.id, email: user.email, display_name: user.display_name },
    period: {
      month,
      year,
      label: `${MONTH_NAMES[month]} ${year}`,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    summary: {
      totalRides: rides.length,
      totalDistance_m: totalDistance,
      totalDuration_seconds: totalDuration,
      weightedAvgAqi,
      exposureScore,
      ratioToWho,
      whoComparison: whoComparison(ratioToWho),
      cleanestRide: cleanestRide ? {
        id: cleanestRide.id,
        started_at: cleanestRide.started_at,
        distance_m: parseInt(cleanestRide.distance_m) || 0,
        avg_aqi: parseFloat(cleanestRide.avg_aqi),
      } : null,
      mostPollutedRide: mostPollutedRide ? {
        id: mostPollutedRide.id,
        started_at: mostPollutedRide.started_at,
        distance_m: parseInt(mostPollutedRide.distance_m) || 0,
        avg_aqi: parseFloat(mostPollutedRide.avg_aqi),
      } : null,
    },
    weeklyBreakdown,
    rides: enrichedRides,
  };
}

module.exports = { getMonthlyReportData };
