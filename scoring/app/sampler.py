import asyncio
import math

from app.models import AqiSample

INTERVAL_M = 500
MIN_SAMPLES = 2
MAX_SAMPLES = 50


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(max(0.0, a)))


def sample_points(
    coords: list[list[float]], interval_m: float = INTERVAL_M
) -> list[dict]:
    """Walk a GeoJSON polyline and return positions at interval_m intervals.

    coords are [lng, lat] per GeoJSON convention.
    Returns dicts with lat, lng, distance_m.
    All distance_m values are capped at the total haversine length of the route.
    """
    if len(coords) < 2:
        lng0, lat0 = coords[0]
        return [{"lat": lat0, "lng": lng0, "distance_m": 0.0}]

    # Pre-compute all segment lengths so total_length is known before sampling
    seg_lengths: list[float] = []
    for i in range(1, len(coords)):
        lng_prev, lat_prev = coords[i - 1]
        lng_curr, lat_curr = coords[i]
        seg_lengths.append(haversine_m(lat_prev, lng_prev, lat_curr, lng_curr))
    total_length = sum(seg_lengths)

    samples: list[dict] = []
    accumulated = 0.0
    next_sample_at = interval_m

    lng0, lat0 = coords[0]
    samples.append({"lat": lat0, "lng": lng0, "distance_m": 0.0})

    for i, seg_len in enumerate(seg_lengths):
        lng_prev, lat_prev = coords[i]
        lng_curr, lat_curr = coords[i + 1]

        while next_sample_at <= accumulated + seg_len:
            if len(samples) >= MAX_SAMPLES:
                break
            t = (next_sample_at - accumulated) / seg_len if seg_len > 0 else 0.0
            samples.append({
                "lat": lat_prev + t * (lat_curr - lat_prev),
                "lng": lng_prev + t * (lng_curr - lng_prev),
                "distance_m": min(next_sample_at, total_length),
            })
            next_sample_at += interval_m

        accumulated += seg_len

        if len(samples) >= MAX_SAMPLES:
            break

    # Always include the true end point; distance_m is the computed total length
    lng_end, lat_end = coords[-1]
    end_point = {"lat": lat_end, "lng": lng_end, "distance_m": total_length}

    last = samples[-1]
    if last["lat"] != lat_end or last["lng"] != lng_end:
        if len(samples) < MAX_SAMPLES:
            samples.append(end_point)
        else:
            samples[-1] = end_point

    return samples


async def sample_route(
    coords: list[list[float]],
    aqi_client,
    interval_m: float = INTERVAL_M,
    forecast_date: str | None = None,
) -> list[AqiSample]:
    positions = sample_points(coords, interval_m)

    if forecast_date:
        results = await asyncio.gather(
            *[aqi_client.get_forecast_aqi(p["lat"], p["lng"], forecast_date) for p in positions]
        )
        return [
            AqiSample(lat=p["lat"], lng=p["lng"], aqi=aqi_val, distanceM=p["distance_m"])
            for p, aqi_val in zip(positions, results)
        ]

    results = await asyncio.gather(
        *[aqi_client.get_aqi(p["lat"], p["lng"]) for p in positions]
    )
    return [
        AqiSample(lat=p["lat"], lng=p["lng"], aqi=aqi_val, distanceM=p["distance_m"])
        for p, (aqi_val, _) in zip(positions, results)
    ]
