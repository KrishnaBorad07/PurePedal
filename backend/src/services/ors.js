const axios = require("axios");
const config = require("../config");
const { OrsApiError, OrsNoRouteError } = require("../utils/errors");

const orsClient = axios.create({
  baseURL: "https://api.heigit.org/openrouteservice",
  timeout: 10_000,
});

const ROUTE_TYPES = ["recommended", "alternative", "fastest"];

function normalizeRoute(route, index) {
  const geoJson = route.geometry;

  const steps = route.segments?.[0]?.steps ?? [];
  const instructions = steps.map((step) => ({
    text: step.instruction,
    distance_m: Math.round(step.distance),
    duration_s: Math.round(step.duration),
  }));

  return {
    id: `ors:${index}`,
    type: ROUTE_TYPES[index] ?? "alternative",
    geometry: geoJson,
    distance_m: Math.round(route.summary.distance),
    duration_s: Math.round(route.summary.duration),
    elevation_gain_m: Math.round(route.summary.ascent ?? 0),
    elevation_loss_m: Math.round(route.summary.descent ?? 0),
    instructions,
    bbox: route.bbox ?? [],
  };
}

async function getCyclingRoutes(origin, destination) {
  try {
    const response = await orsClient.post(
      "/v2/directions/cycling-regular",
      {
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        alternative_routes: { target_count: 3, weight_factor: 1.4 },
        instructions: true,
        elevation: true,
        geometry_format: "geojson",
        extra_info: ["waytype", "surface"],
        preference: "recommended",
      },
      {
        headers: {
          Authorization: config.ors.key,
        },
      }
    );

    const rawRoutes = response.data.routes;
    if (!rawRoutes || rawRoutes.length === 0) {
      throw new OrsNoRouteError("No cycling route found between these locations.");
    }

    const normalized = rawRoutes.map((r, i) => normalizeRoute(r, i));

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
      throw new OrsApiError(
        err.message ?? "OpenRouteService request failed."
      );
    }
    throw err;
  }
}

module.exports = { getCyclingRoutes };
