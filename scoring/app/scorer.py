from app.models import AqiSample, ScoreDetail, WeightInput


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def compute_score(
    samples: list[AqiSample],
    distance_m: float,
    elevation_gain_m: float,
    weights: WeightInput,
    shortest_distance_m: float,
) -> ScoreDetail:
    aqi_values = [s.aqi for s in samples]
    avg_aqi = sum(aqi_values) / len(aqi_values)
    max_aqi = max(aqi_values)

    aqi_score = _clamp(100.0 - (avg_aqi / 2.0))
    dist_score = _clamp((shortest_distance_m / distance_m) * 100.0) if distance_m > 0 else 100.0
    elev_score = _clamp(100.0 - (elevation_gain_m / 10.0))

    final = (
        weights.aqi * aqi_score
        + weights.distance * dist_score
        + weights.elevation * elev_score
    )

    return ScoreDetail(
        final=round(final, 2),
        aqi=round(aqi_score, 2),
        distance=round(dist_score, 2),
        elevation=round(elev_score, 2),
        avgAqi=round(avg_aqi, 2),
        maxAqi=round(max_aqi, 2),
        aqiSamples=samples,
    )


def rank_routes(scored: list[tuple]) -> list[tuple]:
    """Sort (route, samples, score_detail) by final score then aqi sub-score, descending."""
    return sorted(scored, key=lambda x: (x[2].final, x[2].aqi), reverse=True)
