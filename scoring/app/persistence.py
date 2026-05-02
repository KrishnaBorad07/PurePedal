import asyncio
import logging

import psycopg2

from app.models import AqiSample

logger = logging.getLogger(__name__)


def _write_sync(database_url: str, samples: list[AqiSample]) -> None:
    conn = None
    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        for sample in samples:
            cur.execute(
                """
                INSERT INTO aqi_history (location, aqi_value, source)
                VALUES (ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s)
                """,
                (sample.lng, sample.lat, sample.aqi, "scoring-sample"),
            )
        conn.commit()
        cur.close()
    except Exception as exc:
        logger.warning("Failed to persist aqi_history: %s", exc)
    finally:
        if conn:
            conn.close()


async def write_aqi_samples(database_url: str, samples: list[AqiSample]) -> None:
    await asyncio.to_thread(_write_sync, database_url, samples)
