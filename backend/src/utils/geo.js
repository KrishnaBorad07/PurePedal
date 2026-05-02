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

module.exports = {
  isValidLatLng,
  toGeohash,
  getBoundingBoxGeohashes,
  haversineDistance,
  boundingBoxArea,
};
