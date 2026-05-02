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

module.exports = {
  WaqiApiError,
  StationTooFarError,
  NoForecastAvailableError,
  CacheError,
};
