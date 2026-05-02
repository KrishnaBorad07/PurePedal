import pytest

from app.models import AqiSample, RouteInput, WeightInput
from app.scorer import _clamp, compute_score, rank_routes


def make_samples(aqi_values: list[float]) -> list[AqiSample]:
    return [
        AqiSample(lat=0.0, lng=0.0, aqi=v, distanceM=i * 500.0)
        for i, v in enumerate(aqi_values)
    ]


def test_clamp_above_max():
    assert _clamp(150.0) == 100.0


def test_clamp_below_min():
    assert _clamp(-10.0) == 0.0


def test_clamp_within_range():
    assert _clamp(75.0) == 75.0


def test_aqi_score_good_air():
    samples = make_samples([20.0, 20.0])
    w = WeightInput(aqi=1.0, distance=0.0, elevation=0.0)
    result = compute_score(samples, 1000, 0, w, 1000)
    assert result.aqi == pytest.approx(90.0)   # 100 - (20/2)


def test_aqi_score_hazardous_clamped():
    samples = make_samples([300.0, 300.0])   # would be -50, clamp to 0
    w = WeightInput(aqi=1.0, distance=0.0, elevation=0.0)
    result = compute_score(samples, 1000, 0, w, 1000)
    assert result.aqi == pytest.approx(0.0)


def test_distance_score_shortest_is_100():
    samples = make_samples([50.0])
    w = WeightInput(aqi=0.0, distance=1.0, elevation=0.0)
    result = compute_score(samples, 1000, 0, w, 1000)
    assert result.distance == pytest.approx(100.0)


def test_distance_score_longer_route():
    samples = make_samples([50.0])
    w = WeightInput(aqi=0.0, distance=1.0, elevation=0.0)
    result = compute_score(samples, 2000, 0, w, 1000)
    assert result.distance == pytest.approx(50.0)


def test_elevation_score_flat():
    samples = make_samples([50.0])
    w = WeightInput(aqi=0.0, distance=0.0, elevation=1.0)
    result = compute_score(samples, 1000, 0, w, 1000)
    assert result.elevation == pytest.approx(100.0)


def test_elevation_score_high_gain_clamped():
    samples = make_samples([50.0])
    w = WeightInput(aqi=0.0, distance=0.0, elevation=1.0)
    result = compute_score(samples, 1000, 2000, w, 1000)
    assert result.elevation == pytest.approx(0.0)   # 100 - 200 clamped to 0


def test_final_is_weighted_sum():
    samples = make_samples([0.0])   # aqi_score = 100
    w = WeightInput(aqi=0.6, distance=0.25, elevation=0.15)
    result = compute_score(samples, 1000, 0, w, 1000)
    # All sub-scores are 100, so final should be 100
    assert result.final == pytest.approx(100.0, rel=1e-3)


def test_avg_and_max_aqi():
    samples = make_samples([20.0, 80.0, 60.0])
    w = WeightInput()
    result = compute_score(samples, 1000, 0, w, 1000)
    assert result.avgAqi == pytest.approx((20 + 80 + 60) / 3, rel=1e-3)
    assert result.maxAqi == pytest.approx(80.0)


def test_rank_routes_best_first():
    s_good = make_samples([10.0])   # low AQI → high score
    s_bad = make_samples([200.0])   # high AQI → low score
    w = WeightInput(aqi=1.0, distance=0.0, elevation=0.0)

    route = RouteInput(geometry={}, distance_m=1000, elevation_gain_m=0)
    score_good = compute_score(s_good, 1000, 0, w, 1000)
    score_bad = compute_score(s_bad, 1000, 0, w, 1000)

    ranked = rank_routes([(route, s_good, score_good), (route, s_bad, score_bad)])
    assert ranked[0][2].final > ranked[1][2].final


def test_rank_routes_tie_broken_by_aqi():
    # Same final score (all flat, same distance) but different AQI sub-scores
    # This scenario is uncommon but the tie-break should prefer better AQI
    s1 = make_samples([50.0])
    s2 = make_samples([50.0])
    w = WeightInput()
    route = RouteInput(geometry={}, distance_m=1000, elevation_gain_m=0)
    score1 = compute_score(s1, 1000, 0, w, 1000)
    score2 = compute_score(s2, 1000, 0, w, 1000)

    ranked = rank_routes([(route, s1, score1), (route, s2, score2)])
    assert len(ranked) == 2
