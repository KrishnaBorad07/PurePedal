import json
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis as fake_aioredis
import pygeohash as geohash
import pytest

from app.aqi_client import FALLBACK_AQI, AqiClient
from app.models import AqiSample
from app.sampler import sample_route


def _make_redis():
    return fake_aioredis.FakeRedis(decode_responses=True)


def _forecast_key(lat: float, lng: float) -> str:
    return f"aqi:forecast:{geohash.encode(lat, lng, precision=5)}"


FORECAST_PAYLOAD = {
    "forecast": [
        {"day": "2026-05-01", "avg": 45, "min": 30, "max": 65},
        {"day": "2026-05-02", "avg": 80, "min": 55, "max": 110},
    ]
}


async def test_get_forecast_aqi_returns_correct_avg_for_matched_date():
    r = _make_redis()
    await r.set(_forecast_key(19.0, 72.8), json.dumps(FORECAST_PAYLOAD))

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-01")

    assert result == 45.0


async def test_get_forecast_aqi_returns_correct_avg_for_second_day():
    r = _make_redis()
    await r.set(_forecast_key(19.0, 72.8), json.dumps(FORECAST_PAYLOAD))

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-02")

    assert result == 80.0


async def test_get_forecast_aqi_returns_fallback_when_date_not_in_forecast():
    r = _make_redis()
    await r.set(_forecast_key(19.0, 72.8), json.dumps(FORECAST_PAYLOAD))

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-10")

    assert result == FALLBACK_AQI


async def test_get_forecast_aqi_returns_fallback_on_cache_miss():
    r = _make_redis()  # empty cache

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-01")

    assert result == FALLBACK_AQI


async def test_get_forecast_aqi_returns_fallback_on_redis_error():
    r = _make_redis()
    r.get = AsyncMock(side_effect=Exception("Redis unavailable"))

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-01")

    assert result == FALLBACK_AQI


async def test_get_forecast_aqi_returns_fallback_on_malformed_json():
    r = _make_redis()
    await r.set(_forecast_key(19.0, 72.8), "not-valid-json")

    client = AqiClient(r)
    result = await client.get_forecast_aqi(19.0, 72.8, "2026-05-01")

    assert result == FALLBACK_AQI


# ── sample_route with forecast_date ──────────────────────────────────────────

SIMPLE_COORDS = [[72.877, 19.076], [72.877, 19.113]]  # GeoJSON [lng, lat]


async def test_sample_route_calls_get_forecast_aqi_when_forecast_date_provided():
    r = _make_redis()
    await r.set(_forecast_key(19.076, 72.877), json.dumps(FORECAST_PAYLOAD))
    await r.set(_forecast_key(19.113, 72.877), json.dumps(FORECAST_PAYLOAD))

    client = AqiClient(r)
    samples = await sample_route(SIMPLE_COORDS, client, forecast_date="2026-05-01")

    assert len(samples) >= 2
    for s in samples:
        assert isinstance(s, AqiSample)
        # All points should get forecast AQI = 45 (matched day)
        assert s.aqi == 45.0


async def test_sample_route_calls_get_aqi_when_forecast_date_is_none():
    r = _make_redis()
    # Set point AQI (live), not forecast
    live_key = f"aqi:point:{geohash.encode(19.076, 72.877, precision=5)}"
    await r.set(live_key, json.dumps({"aqi": 33}))

    client = AqiClient(r)
    samples = await sample_route(SIMPLE_COORDS, client, forecast_date=None)

    assert len(samples) >= 2
    # First sample should have the live AQI value
    assert samples[0].aqi == 33.0
