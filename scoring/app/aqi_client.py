import json
import logging

import pygeohash as geohash
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

FALLBACK_AQI = 75.0


class AqiClient:
    def __init__(self, redis_conn: aioredis.Redis) -> None:
        self._redis = redis_conn
        self._hits = 0
        self._total = 0

    async def get_aqi(self, lat: float, lng: float) -> tuple[float, bool]:
        self._total += 1
        key = f"aqi:point:{geohash.encode(lat, lng, precision=5)}"
        try:
            raw = await self._redis.get(key)
            if raw is not None:
                data = json.loads(raw)
                aqi_value = float(data["aqi"])
                self._hits += 1
                return aqi_value, True
        except Exception:
            logger.warning("AQI cache read failed for (%s, %s)", lat, lng)
        return FALLBACK_AQI, False

    async def get_forecast_aqi(self, lat: float, lng: float, forecast_date: str) -> float:
        """Return avg AQI for forecast_date from the Redis forecast cache. Fallback: 75.0."""
        try:
            key = f"aqi:forecast:{geohash.encode(lat, lng, precision=5)}"
            raw = await self._redis.get(key)
            if raw is None:
                return FALLBACK_AQI
            data = json.loads(raw)
            for entry in data.get("forecast", []):
                if entry.get("day") == forecast_date:
                    return float(entry["avg"])
        except Exception:
            logger.warning("Forecast AQI cache read failed for (%s, %s) date=%s", lat, lng, forecast_date)
        return FALLBACK_AQI

    @property
    def hit_rate(self) -> float:
        if self._total == 0:
            return 0.0
        return self._hits / self._total
