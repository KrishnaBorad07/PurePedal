const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");
const { OrsApiError, OrsNoRouteError } = require("../utils/errors");

const orsClient = axios.create({
  baseURL: "https://api.heigit.org/openrouteservice",
  timeout: 10_000,
});

const ROUTE_TYPES = ["recommended", "alternative", "fastest"];

function normalizeRoute(feature, index) {
  // /geojson endpoint returns coordinates as [lng, lat] or [lng, lat, elevation].
  // Strip the elevation component so downstream code always receives 2D [lng, lat].
  const rawCoords = feature.geometry.coordinates;
  const coords = rawCoords.map((c) => (c.length > 2 ? [c[0], c[1]] : c));

  const props = feature.properties;
  const steps = (props.segments ?? []).flatMap((seg) => seg.steps ?? []);
  const instructions = steps.map((step) => ({
    text: step.instruction,
    distance_m: Math.round(step.distance),
    duration_s: Math.round(step.duration),
    manoeuvreType: step.type ?? 0,
    waypointIndex: step.way_points?.[0] ?? 0,
  }));

  return {
    id: `ors:${index}`,
    type: ROUTE_TYPES[index] ?? "alternative",
    geometry: { type: "LineString", coordinates: coords },
    distance_m: Math.round(props.summary.distance),
    duration_s: Math.round(props.summary.duration),
    elevation_gain_m: Math.round(props.ascent ?? 0),
    elevation_loss_m: Math.round(props.descent ?? 0),
    instructions,
    bbox: feature.bbox ?? [],
  };
}

function extractOrsMessage(err) {
  return (
    err.response?.data?.error?.message ??
    err.response?.data?.message ??
    err.message ??
    "OpenRouteService request failed."
  );
}

async function getCyclingRoutes(origin, destination) {
  const headers = { Authorization: config.ors.key };
  const baseBody = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    instructions: true,
    elevation: true,
  };

  let response;
  try {
    try {
      response = await orsClient.post(
        "/v2/directions/cycling-regular/geojson",
        { ...baseBody, alternative_routes: { target_count: 3, weight_factor: 1.4 } },
        { headers }
      );
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        // ORS rejects alternative_routes for routes that are too short or too
        // constrained — fall back to the single best route
        logger.warn(
          { orsError: err.response?.data },
          "ORS rejected alternative_routes — retrying without"
        );
        response = await orsClient.post(
          "/v2/directions/cycling-regular/geojson",
          baseBody,
          { headers }
        );
      } else {
        throw err;
      }
    }

    const features = response.data.features;
    if (!features || features.length === 0) {
      throw new OrsNoRouteError("No cycling route found between these locations.");
    }

    const normalized = features.map((f, i) => normalizeRoute(f, i));

    // Re-assign "fastest" to whichever route has the lowest duration_s
    if (normalized.length > 1) {
      const fastestIdx = normalized.reduce(
        (minIdx, r, i, arr) => (r.duration_s < arr[minIdx].duration_s ? i : minIdx),
        0
      );
      if (fastestIdx !== normalized.findIndex((r) => r.type === "fastest")) {
        normalized.forEach((r) => {
          if (r.type === "fastest") r.type = "alternative";
        });
        normalized[fastestIdx].type = "fastest";
      }
    }

    return normalized;
  } catch (err) {
    if (err instanceof OrsNoRouteError) throw err;
    if (axios.isAxiosError(err)) {
      logger.warn({ orsError: err.response?.data }, "ORS API error");
      throw new OrsApiError(extractOrsMessage(err));
    }
    throw err;
  }
}

module.exports = { getCyclingRoutes };
