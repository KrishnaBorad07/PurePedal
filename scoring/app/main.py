import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import psycopg2
import redis.asyncio as aioredis
from fastapi import FastAPI, Request

from app.aqi_client import AqiClient
from app.config import settings
from app.models import RankedRoute, ScoreRequest, ScoreResponse, ScoringMetadata
from app.persistence import write_aqi_samples
from app.sampler import sample_route
from app.scorer import compute_score, rank_routes

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis_conn = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    app.state.redis = redis_conn
    yield
    await redis_conn.aclose()


app = FastAPI(
    title="PurePedal Scoring Service",
    version="1.0.0",
    docs_url="/docs",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    checks = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "purepedal-scoring",
        "dependencies": {},
    }

    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cur = conn.cursor()
        cur.execute("SELECT PostGIS_Version()")
        version = cur.fetchone()[0]
        cur.close()
        conn.close()
        checks["dependencies"]["postgres"] = {"status": "ok", "postgis": version}
    except Exception as e:
        checks["dependencies"]["postgres"] = {"status": "error", "message": str(e)}
        checks["status"] = "degraded"

    try:
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        checks["dependencies"]["redis"] = {"status": "ok"}
    except Exception as e:
        checks["dependencies"]["redis"] = {"status": "error", "message": str(e)}
        checks["status"] = "degraded"

    return checks


@app.post("/score", response_model=ScoreResponse)
async def score_routes(payload: ScoreRequest, req: Request):
    aqi_client = AqiClient(req.app.state.redis)

    all_samples = []
    for route in payload.routes:
        coords = route.geometry["coordinates"]
        samples = await sample_route(coords, aqi_client)
        all_samples.append(samples)

    shortest_distance_m = min(r.distance_m for r in payload.routes)

    scored = []
    for route, samples in zip(payload.routes, all_samples):
        score_detail = compute_score(
            samples=samples,
            distance_m=route.distance_m,
            elevation_gain_m=route.elevation_gain_m,
            weights=payload.weights,
            shortest_distance_m=shortest_distance_m,
        )
        scored.append((route, samples, score_detail))

    ranked = rank_routes(scored)

    if payload.userId:
        flat_samples = [s for _, route_samples, _ in scored for s in route_samples]
        asyncio.create_task(write_aqi_samples(settings.DATABASE_URL, flat_samples))

    ranked_routes = [
        RankedRoute(
            rank=rank,
            id=route.id,
            geometry=route.geometry,
            distance_m=route.distance_m,
            elevation_gain_m=route.elevation_gain_m,
            duration_s=route.duration_s,
            score=score,
        )
        for rank, (route, _, score) in enumerate(ranked, 1)
    ]

    samples_per_route = len(all_samples[0]) if all_samples else 0

    return ScoreResponse(
        routes=ranked_routes,
        metadata=ScoringMetadata(
            samplingIntervalM=settings.AQI_SAMPLE_INTERVAL_M,
            totalSamplesPerRoute=samples_per_route,
            aqiSourceCacheHitRate=round(aqi_client.hit_rate, 4),
        ),
    )
