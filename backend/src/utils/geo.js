const ngeohash = require("ngeohash");

function isValidLatLng(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toGeohash(lat, lng, precision) {
  if (!isValidLatLng(lat, lng)) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
  }
  return ngeohash.encode(lat, lng, precision);
}

function getBoundingBoxGeohashes(latMin, lngMin, latMax, lngMax, precision) {
  const sw = ngeohash.encode(latMin, lngMin, precision);
  const ne = ngeohash.encode(latMax, lngMax, precision);
  return [sw, ne];
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function boundingBoxArea(latMin, lngMin, latMax, lngMax) {
  return (latMax - latMin) * (lngMax - lngMin);
}

function interpolatePoint(coordinates, targetDistanceM) {
  if (targetDistanceM <= 0) {
    return { lat: coordinates[0][1], lng: coordinates[0][0] };
  }
  let cumulative = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];
    const segLen = haversineDistance(lat1, lng1, lat2, lng2);
    if (cumulative + segLen >= targetDistanceM) {
      const fraction = segLen > 0 ? (targetDistanceM - cumulative) / segLen : 0;
      return {
        lat: lat1 + fraction * (lat2 - lat1),
        lng: lng1 + fraction * (lng2 - lng1),
      };
    }
    cumulative += segLen;
  }
  const last = coordinates[coordinates.length - 1];
  return { lat: last[1], lng: last[0] };
}

function _perpendicularDistance(point, lineStart, lineEnd) {
  const [x0, y0] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2);
  }
  const t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy);
  return Math.sqrt((x0 - (x1 + t * dx)) ** 2 + (y0 - (y1 + t * dy)) ** 2);
}

function simplifyTrack(coordinates, tolerance = 0.0001) {
  if (coordinates.length < 3) return coordinates.slice();
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < coordinates.length - 1; i++) {
    const dist = _perpendicularDistance(coordinates[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyTrack(coordinates.slice(0, maxIdx + 1), tolerance);
    const right = simplifyTrack(coordinates.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function sampleTrack(coordinates, intervalM = 500, maxSamples = 50) {
  let totalDistance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  const sampleDistances = [];
  let d = 0;
  while (d <= totalDistance && sampleDistances.length < maxSamples) {
    sampleDistances.push(d);
    d += intervalM;
  }
  const lastSampled = sampleDistances[sampleDistances.length - 1];
  if (lastSampled < totalDistance && sampleDistances.length < maxSamples) {
    sampleDistances.push(totalDistance);
  }
  return sampleDistances.map((dist) => {
    const point = interpolatePoint(coordinates, dist);
    return { ...point, distanceFromStart_m: dist };
  });
}

function getCurrentWeekBounds(now = new Date()) {
  const day = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { weekStart: monday, weekEnd: sunday };
}

module.exports = {
  isValidLatLng,
  toGeohash,
  getBoundingBoxGeohashes,
  haversineDistance,
  boundingBoxArea,
  interpolatePoint,
  simplifyTrack,
  sampleTrack,
  getCurrentWeekBounds,
};
