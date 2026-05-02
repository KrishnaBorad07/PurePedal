const aqiCache = require("../services/aqiCache");
const { isValidLatLng, boundingBoxArea } = require("../utils/geo");
const {
  WaqiApiError,
  StationTooFarError,
  NoForecastAvailableError,
} = require("../utils/errors");

function parseCoord(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function getCategory(aqi) {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy-for-sensitive-groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very-unhealthy";
  return "hazardous";
}

async function getCurrentAqi(req, res, next) {
  try {
    const lat = parseCoord(req.query.lat);
    const lng = parseCoord(req.query.lng);

    if (lat === null || lng === null) {
      return res.status(400).json({ error: "lat and lng are required numbers." });
    }
    if (!isValidLatLng(lat, lng)) {
      return res.status(400).json({ error: "lat or lng out of valid range." });
    }

    const result = await aqiCache.getAqiForPoint(lat, lng);
    return res.json(result);
  } catch (err) {
    if (err instanceof StationTooFarError) {
      return res
        .status(404)
        .json({ error: "No air quality station found near this location." });
    }
    if (err instanceof WaqiApiError) {
      return res
        .status(502)
        .json({ error: err.message || "Air quality data temporarily unavailable." });
    }
    next(err);
  }
}

async function getHeatmap(req, res, next) {
  try {
    const latMin = parseCoord(req.query.latMin);
    const lngMin = parseCoord(req.query.lngMin);
    const latMax = parseCoord(req.query.latMax);
    const lngMax = parseCoord(req.query.lngMax);

    if (latMin === null || lngMin === null || latMax === null || lngMax === null) {
      return res
        .status(400)
        .json({ error: "latMin, lngMin, latMax, lngMax are required." });
    }
    if (!isValidLatLng(latMin, lngMin) || !isValidLatLng(latMax, lngMax)) {
      return res
        .status(400)
        .json({ error: "Bounding box coordinates out of valid range." });
    }
    if (latMax <= latMin || lngMax <= lngMin) {
      return res
        .status(400)
        .json({ error: "latMax must be > latMin and lngMax must be > lngMin." });
    }
    if (boundingBoxArea(latMin, lngMin, latMax, lngMax) > 4) {
      return res.status(400).json({ error: "Bounding box too large." });
    }

    const { stations, cached } = await aqiCache.getAqiForBounds(
      latMin,
      lngMin,
      latMax,
      lngMax
    );

    const compactStations = stations.map(({ pollutants, ...rest }) => rest);

    return res.json({ stations: compactStations, count: compactStations.length, cached });
  } catch (err) {
    if (err instanceof WaqiApiError) {
      return res
        .status(502)
        .json({ error: "Air quality data temporarily unavailable." });
    }
    next(err);
  }
}

async function getForecast(req, res, next) {
  try {
    const lat = parseCoord(req.query.lat);
    const lng = parseCoord(req.query.lng);
    let hours = parseInt(req.query.hours, 10);
    if (isNaN(hours) || hours < 1) hours = 24;
    if (hours > 48) hours = 48;

    if (lat === null || lng === null) {
      return res.status(400).json({ error: "lat and lng are required numbers." });
    }
    if (!isValidLatLng(lat, lng)) {
      return res.status(400).json({ error: "lat or lng out of valid range." });
    }

    const result = await aqiCache.getForecastForPoint(lat, lng);

    const forecastArray = result.daily?.pm25 ?? result.hourly?.pm25 ?? [];
    const truncated = forecastArray.slice(0, hours).map((entry) => ({
      hour: entry.day,
      aqi: entry.avg,
      category: getCategory(entry.avg),
    }));

    return res.json({
      lat,
      lng,
      forecast: truncated,
      hoursReturned: truncated.length,
      cached: result.cached,
    });
  } catch (err) {
    if (err instanceof NoForecastAvailableError) {
      return res.status(404).json({
        error: "No air quality station or forecast available at this location.",
      });
    }
    if (err instanceof WaqiApiError) {
      return res
        .status(502)
        .json({ error: "Air quality data temporarily unavailable." });
    }
    next(err);
  }
}

module.exports = { getCurrentAqi, getHeatmap, getForecast };
