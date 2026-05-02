from unittest.mock import patch

import fakeredis.aioredis as fake_aioredis
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

LINESTRING = {
    "type": "LineString",
    "coordinates": [
        [-74.006, 40.7128],
        [-73.996, 40.7128],
        [-73.986, 40.7128],
    ],
}

ROUTE = {"geometry": LINESTRING, "distance_m": 2000, "elevation_gain_m": 20}


@pytest.fixture
async def client():
    fake_redis = fake_aioredis.FakeRedis(decode_responses=True)

    with patch("psycopg2.connect", side_effect=Exception("no db in tests")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # Set after lifespan startup so it's available to all request handlers
            app.state.redis = fake_redis
            yield ac


async def test_health_returns_200(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "dependencies" in data


async def test_score_single_route(client):
    resp = await client.post("/score", json={"routes": [ROUTE]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["routes"]) == 1
    assert data["routes"][0]["rank"] == 1
    assert "score" in data["routes"][0]
    assert "metadata" in data


async def test_score_three_routes_returns_all_ranked(client):
    payload = {
        "routes": [
            {"geometry": LINESTRING, "distance_m": 1000, "elevation_gain_m": 0},
            {"geometry": LINESTRING, "distance_m": 2000, "elevation_gain_m": 100},
            {"geometry": LINESTRING, "distance_m": 3000, "elevation_gain_m": 500},
        ]
    }
    resp = await client.post("/score", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["routes"]) == 3
    ranks = sorted(r["rank"] for r in data["routes"])
    assert ranks == [1, 2, 3]


async def test_score_rejects_empty_routes(client):
    resp = await client.post("/score", json={"routes": []})
    assert resp.status_code == 422


async def test_score_rejects_four_routes(client):
    resp = await client.post("/score", json={"routes": [ROUTE] * 4})
    assert resp.status_code == 422


async def test_score_custom_weights_normalized(client):
    payload = {
        "routes": [ROUTE],
        "weights": {"aqi": 2.0, "distance": 1.0, "elevation": 1.0},
    }
    resp = await client.post("/score", json=payload)
    assert resp.status_code == 200


async def test_score_metadata_structure(client):
    resp = await client.post("/score", json={"routes": [ROUTE]})
    assert resp.status_code == 200
    meta = resp.json()["metadata"]
    assert meta["samplingIntervalM"] == 500
    assert isinstance(meta["totalSamplesPerRoute"], int)
    assert 0.0 <= meta["aqiSourceCacheHitRate"] <= 1.0


async def test_score_aqi_samples_in_response(client):
    resp = await client.post("/score", json={"routes": [ROUTE]})
    assert resp.status_code == 200
    score = resp.json()["routes"][0]["score"]
    assert len(score["aqiSamples"]) >= 2
    for sample in score["aqiSamples"]:
        assert "lat" in sample
        assert "lng" in sample
        assert "aqi" in sample
        assert "distanceM" in sample


async def test_score_uses_fallback_aqi_on_cache_miss(client):
    resp = await client.post("/score", json={"routes": [ROUTE]})
    assert resp.status_code == 200
    score = resp.json()["routes"][0]["score"]
    # All samples should use fallback (75.0) since fakeredis has no data
    for sample in score["aqiSamples"]:
        assert sample["aqi"] == pytest.approx(75.0)
    # Hit rate should be 0
    assert resp.json()["metadata"]["aqiSourceCacheHitRate"] == 0.0
