from fastapi import FastAPI
from datetime import datetime, timezone

import redis.asyncio as aioredis
import psycopg2

from app.config import settings

app = FastAPI(
    title="PurePedal Scoring Service",
    version="0.1.0",
    docs_url="/docs",
)


@app.get("/health")
async def health():
    checks = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "purepedal-scoring",
        "dependencies": {},
    }

    # Postgres
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

    # Redis
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        pong = await r.ping()
        await r.aclose()
        checks["dependencies"]["redis"] = {"status": "ok"}
    except Exception as e:
        checks["dependencies"]["redis"] = {"status": "error", "message": str(e)}
        checks["status"] = "degraded"

    return checks


@app.post("/score")
async def score_routes(payload: dict):
    """
    Placeholder for Sprint 3.
    Accepts candidate route geometries, samples AQI along each,
    and returns ranked routes with score breakdowns.
    """
    return {
        "message": "Scoring endpoint ready — implementation in Sprint 3",
        "routes_received": len(payload.get("routes", [])),
    }
