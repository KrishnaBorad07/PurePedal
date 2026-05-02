class WaqiApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "WaqiApiError";
  }
}

class StationTooFarError extends Error {
  constructor(message) {
    super(message);
    this.name = "StationTooFarError";
  }
}

class NoForecastAvailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoForecastAvailableError";
  }
}

class CacheError extends Error {
  constructor(message) {
    super(message);
    this.name = "CacheError";
  }
}

class OrsApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrsApiError";
  }
}

class OrsNoRouteError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrsNoRouteError";
  }
}

class ScoringServiceError extends Error {
  constructor(message, isTimeout = false) {
    super(message);
    this.name = "ScoringServiceError";
    this.isTimeout = isTimeout;
  }
}

module.exports = {
  WaqiApiError,
  StationTooFarError,
  NoForecastAvailableError,
  CacheError,
  OrsApiError,
  OrsNoRouteError,
  ScoringServiceError,
};
