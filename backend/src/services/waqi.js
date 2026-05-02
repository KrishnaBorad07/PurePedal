const axios = require("axios");
const config = require("../config");
const { haversineDistance } = require("../utils/geo");
const {
  WaqiApiError,
  StationTooFarError,
  NoForecastAvailableError,
} = require("../utils/errors");

const WAQI_BASE = "https://api.waqi.info";
const MAX_STATION_DISTANCE_M = 50_000;

const http = axios.create({ timeout: 5000 });

function getCategory(aqi) {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy-for-sensitive-groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very-unhealthy";
  return "hazardous";
}

const POLLUTANT_KEYS = ["pm25", "pm10", "o3", "no2", "so2", "co"];

function normalizeReading(data) {
  const pollutants = {};
  if (data.iaqi) {
    for (const key of POLLUTANT_KEYS) {
      const val = data.iaqi[key]?.v;
      if (val !== undefined && val !== "-") {
        pollutants[key] = val;
      }
    }
  }

  return {
    aqi: data.aqi,
    station: {
      id: `waqi:${data.idx}`,
      name: data.city?.name ?? "Unknown",
      lat: data.city?.geo?.[0] ?? null,
      lng: data.city?.geo?.[1] ?? null,
    },
    dominantPollutant: data.dominentpol ?? null,
    pollutants,
    category: getCategory(data.aqi),
    recordedAt: data.time?.iso ?? new Date().toISOString(),
  };
}

async function getAqiByCoordinates(lat, lng) {
  let res;
  try {
    res = await http.get(
      `${WAQI_BASE}/feed/geo:${lat};${lng}/?token=${config.waqi.token}`
    );
    console.log("WAQI URL:", `${WAQI_BASE}/feed/geo:${lat};${lng}/?token=${config.waqi.token}`);
console.log("WAQI RAW RESPONSE:", res.data);
  } catch (err) {
    throw new WaqiApiError(`WAQI request failed: ${err.message}`);
  }

  const body = res.data;
  if (body.status !== "ok") {
    throw new WaqiApiError(`WAQI returned status: ${body.status}`);
  }

  const stationLat = body.data.city?.geo?.[0];
  const stationLng = body.data.city?.geo?.[1];
  if (stationLat != null && stationLng != null) {
    const dist = haversineDistance(lat, lng, stationLat, stationLng);
    if (dist > MAX_STATION_DISTANCE_M) {
      throw new StationTooFarError(
        `Nearest station is ${Math.round(dist / 1000)}km away (limit 50km)`
      );
    }
  }

  return normalizeReading(body.data);
}

async function getAqiByBounds(latMin, lngMin, latMax, lngMax) {
  let res;
  try {
    res = await http.get(
      `${WAQI_BASE}/map/bounds/?latlng=${latMin},${lngMin},${latMax},${lngMax}&token=${config.waqi.token}`
    );
  } catch (err) {
    throw new WaqiApiError(`WAQI bounds request failed: ${err.message}`);
  }

  const body = res.data;
  if (body.status !== "ok") {
    throw new WaqiApiError(`WAQI returned status: ${body.status}`);
  }

  return body.data.map((station) => normalizeReading(station));
}

async function getForecast(lat, lng) {
  let res;
  try {
    res = await http.get(
      `${WAQI_BASE}/feed/geo:${lat};${lng}/?token=${config.waqi.token}`
    );
  } catch (err) {
    throw new WaqiApiError(`WAQI forecast request failed: ${err.message}`);
  }

  const body = res.data;
  if (body.status !== "ok") {
    throw new WaqiApiError(`WAQI returned status: ${body.status}`);
  }

  if (!body.data.forecast) {
    throw new NoForecastAvailableError(
      "No forecast data available at this location"
    );
  }

  return body.data.forecast;
}

module.exports = { getAqiByCoordinates, getAqiByBounds, getForecast };
