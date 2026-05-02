import json

import fakeredis.aioredis as fake_aioredis
import pygeohash as geohash
import pytest

from app.aqi_client import FALLBACK_AQI, AqiClient


def _make_redis():
    return fake_aioredis.FakeRedis(decode_responses=True)


def _aqi_key(lat: float, lng: float) -> str:
    return f"aqi:point:{geohash.encode(lat, lng, precision=5)}"


async def test_cache_hit_returns_aqi():
    r = _make_redis()
    payload = json.dumps({"aqi": 42, "dominantPollutant": "pm25", "recordedAt": "2024-01-01T00:00:00Z"})
    await r.set(_aqi_key(40.0, -74.0), payload)

    client = AqiClient(r)
    aqi, hit = await client.get_aqi(40.0, -74.0)

    assert aqi == 42.0
    assert hit is True


async def test_cache_miss_returns_fallback():
    r = _make_redis()
    client = AqiClient(r)
    aqi, hit = await client.get_aqi(40.0, -74.0)

    assert aqi == FALLBACK_AQI
    assert hit is False


async def test_hit_rate_all_hits():
    r = _make_redis()
    payload = json.dumps({"aqi": 55})
    await r.set(_aqi_key(40.0, -74.0), payload)
    await r.set(_aqi_key(51.5, -0.1), payload)

    client = AqiClient(r)
    await client.get_aqi(40.0, -74.0)
    await client.get_aqi(51.5, -0.1)

    assert client.hit_rate == 1.0


async def test_hit_rate_half_hits():
    r = _make_redis()
    payload = json.dumps({"aqi": 55})
    await r.set(_aqi_key(40.0, -74.0), payload)

    client = AqiClient(r)
    await client.get_aqi(40.0, -74.0)   # hit
    await client.get_aqi(51.5, -0.1)    # miss

    assert abs(client.hit_rate - 0.5) < 1e-9


async def test_hit_rate_zero_calls():
    r = _make_redis()
    client = AqiClient(r)
    assert client.hit_rate == 0.0


async def test_malformed_cache_value_falls_back():
    r = _make_redis()
    await r.set(_aqi_key(40.0, -74.0), "not-valid-json")

    client = AqiClient(r)
    aqi, hit = await client.get_aqi(40.0, -74.0)

    assert aqi == FALLBACK_AQI
    assert hit is False
