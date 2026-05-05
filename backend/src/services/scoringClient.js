const config = require("../config");
const { ScoringServiceError } = require("../utils/errors");

async function scoreRoutes(routes, weights, userId, forecastDate = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  const body = { routes, weights, userId };
  if (forecastDate) body.forecastDate = forecastDate;

  let response;
  try {
    response = await fetch(`${config.scoring.url}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new ScoringServiceError("Scoring service timed out.", true);
    }
    throw new ScoringServiceError(err.message ?? "Scoring service unreachable.");
  }

  clearTimeout(timer);

  if (!response.ok) {
    let message = "Scoring service error.";
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse failure
    }
    throw new ScoringServiceError(message, false);
  }

  return response.json();
}

module.exports = { scoreRoutes };
