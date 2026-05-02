import pytest

from app.sampler import MAX_SAMPLES, haversine_m, sample_points


def test_haversine_one_degree_latitude():
    dist = haversine_m(0.0, 0.0, 1.0, 0.0)
    assert 110_000 < dist < 112_000


def test_haversine_zero_distance():
    assert haversine_m(40.0, -74.0, 40.0, -74.0) == 0.0


def test_haversine_symmetric():
    d1 = haversine_m(40.0, -74.0, 51.5, -0.1)
    d2 = haversine_m(51.5, -0.1, 40.0, -74.0)
    assert abs(d1 - d2) < 1.0


def test_sample_points_short_route_returns_two():
    # ~155 m segment — shorter than 500 m interval
    coords = [[-74.0, 40.0], [-74.001, 40.001]]
    samples = sample_points(coords)
    assert len(samples) >= 2


def test_sample_points_includes_start():
    coords = [[-74.0, 40.0], [-73.9, 40.0], [-73.8, 40.0]]
    samples = sample_points(coords)
    assert samples[0]["lat"] == pytest.approx(40.0)
    assert samples[0]["lng"] == pytest.approx(-74.0)
    assert samples[0]["distance_m"] == pytest.approx(0.0)


def test_sample_points_includes_end():
    coords = [[-74.0, 40.0], [-73.9, 40.0], [-73.8, 40.0]]
    samples = sample_points(coords)
    assert samples[-1]["lat"] == pytest.approx(40.0, abs=0.01)
    assert samples[-1]["lng"] == pytest.approx(-73.8, abs=0.01)


def test_sample_points_max_capped():
    # ~180 km route — many more than 50 intervals
    coords = [[-74.0 + i * 0.1, 40.0] for i in range(200)]
    samples = sample_points(coords, interval_m=100)
    assert len(samples) <= MAX_SAMPLES


def test_sample_points_distances_non_decreasing():
    coords = [[-74.0 + i * 0.05, 40.0] for i in range(10)]
    samples = sample_points(coords)
    for i in range(1, len(samples)):
        assert samples[i]["distance_m"] >= samples[i - 1]["distance_m"]


def test_sample_points_interval_respected():
    # ~8.5 km straight line — expect samples near 500, 1000, 1500 ...
    coords = [[-74.0, 40.0], [-74.0, 40.077]]  # ~8.6 km north
    samples = sample_points(coords, interval_m=500)
    # Should have start + ~16 interval samples + end
    assert len(samples) >= 3
    # Check second sample is roughly 500 m from start
    assert 400 < samples[1]["distance_m"] < 600


def test_sample_points_single_coord():
    coords = [[-74.0, 40.0]]
    samples = sample_points(coords)
    assert len(samples) == 1
    assert samples[0]["lat"] == 40.0
