import pytest
from pydantic import ValidationError

from app.models import RouteInput, ScoreRequest, WeightInput

ROUTE = RouteInput(
    geometry={"type": "LineString", "coordinates": [[-74.0, 40.0], [-73.9, 40.0]]},
    distance_m=1000,
    elevation_gain_m=10,
)


def test_weight_defaults_sum_to_one():
    w = WeightInput()
    assert abs(w.aqi + w.distance + w.elevation - 1.0) < 1e-6


def test_weight_normalization():
    w = WeightInput(aqi=3.0, distance=1.5, elevation=1.5)
    assert abs(w.aqi + w.distance + w.elevation - 1.0) < 1e-6
    assert abs(w.aqi - 0.5) < 1e-6


def test_weight_already_normalized_unchanged():
    w = WeightInput(aqi=0.6, distance=0.25, elevation=0.15)
    assert abs(w.aqi - 0.6) < 1e-9
    assert abs(w.distance - 0.25) < 1e-9
    assert abs(w.elevation - 0.15) < 1e-9


def test_score_request_valid_single():
    req = ScoreRequest(routes=[ROUTE])
    assert len(req.routes) == 1


def test_score_request_valid_three():
    req = ScoreRequest(routes=[ROUTE, ROUTE, ROUTE])
    assert len(req.routes) == 3


def test_score_request_rejects_empty():
    with pytest.raises(ValidationError):
        ScoreRequest(routes=[])


def test_score_request_rejects_four():
    with pytest.raises(ValidationError):
        ScoreRequest(routes=[ROUTE, ROUTE, ROUTE, ROUTE])


def test_score_request_default_weights():
    req = ScoreRequest(routes=[ROUTE])
    assert abs(req.weights.aqi - 0.6) < 1e-9


def test_score_request_user_id_optional():
    req = ScoreRequest(routes=[ROUTE])
    assert req.userId is None

    req_with_user = ScoreRequest(routes=[ROUTE], userId="user-123")
    assert req_with_user.userId == "user-123"
