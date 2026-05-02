from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator, model_validator


class WeightInput(BaseModel):
    aqi: float = 0.6
    distance: float = 0.25
    elevation: float = 0.15

    @model_validator(mode="after")
    def normalize(self) -> "WeightInput":
        total = self.aqi + self.distance + self.elevation
        if abs(total - 1.0) > 1e-6:
            self.aqi /= total
            self.distance /= total
            self.elevation /= total
        return self


class RouteInput(BaseModel):
    id: Optional[str] = None
    geometry: dict
    distance_m: float
    elevation_gain_m: float
    duration_s: Optional[float] = None


class ScoreRequest(BaseModel):
    routes: list[RouteInput]
    weights: WeightInput = WeightInput()
    userId: Optional[str] = None

    @field_validator("routes")
    @classmethod
    def validate_route_count(cls, v: list) -> list:
        if not 1 <= len(v) <= 3:
            raise ValueError("routes must contain 1–3 items")
        return v


class AqiSample(BaseModel):
    lat: float
    lng: float
    aqi: float
    distanceM: float


class ScoreDetail(BaseModel):
    final: float
    aqi: float
    distance: float
    elevation: float
    avgAqi: float
    maxAqi: float
    aqiSamples: list[AqiSample]


class RankedRoute(BaseModel):
    rank: int
    id: Optional[str] = None
    geometry: dict
    distance_m: float
    elevation_gain_m: float
    duration_s: Optional[float]
    score: ScoreDetail


class ScoringMetadata(BaseModel):
    samplingIntervalM: int
    totalSamplesPerRoute: int
    aqiSourceCacheHitRate: float


class ScoreResponse(BaseModel):
    routes: list[RankedRoute]
    metadata: ScoringMetadata
