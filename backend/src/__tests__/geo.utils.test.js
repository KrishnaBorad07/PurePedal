const {
  isValidLatLng,
  haversineDistance,
  boundingBoxArea,
  toGeohash,
  getBoundingBoxGeohashes,
  interpolatePoint,
  simplifyTrack,
  sampleTrack,
} = require("../utils/geo");

describe("isValidLatLng", () => {
  it("accepts valid coordinates", () => {
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(19.076, 72.877)).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
  });

  it("rejects out-of-range longitude", () => {
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(isValidLatLng("19", 72)).toBe(false);
    expect(isValidLatLng(null, 72)).toBe(false);
  });
});

describe("haversineDistance", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(haversineDistance(19.076, 72.877, 19.076, 72.877)).toBeCloseTo(0, 0);
  });

  it("returns correct distance between Mumbai and Pune (~120km straight-line)", () => {
    const dist = haversineDistance(19.076, 72.877, 18.52, 73.856);
    expect(dist).toBeGreaterThan(115_000);
    expect(dist).toBeLessThan(125_000);
  });

  it("returns distance in metres", () => {
    // 1 degree of latitude ≈ 111km
    const dist = haversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });
});

describe("boundingBoxArea", () => {
  it("returns correct area in square degrees", () => {
    expect(boundingBoxArea(0, 0, 2, 2)).toBeCloseTo(4, 5);
    expect(boundingBoxArea(10, 10, 11, 11)).toBeCloseTo(1, 5);
  });

  it("returns 0 for zero-size box", () => {
    expect(boundingBoxArea(5, 5, 5, 5)).toBe(0);
  });
});

describe("toGeohash", () => {
  it("returns a geohash of the correct precision", () => {
    const hash = toGeohash(19.076, 72.877, 5);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(5);
  });

  it("throws on invalid coordinates", () => {
    expect(() => toGeohash(91, 0, 5)).toThrow();
  });
});

describe("getBoundingBoxGeohashes", () => {
  it("returns [sw, ne] pair of geohashes", () => {
    const [sw, ne] = getBoundingBoxGeohashes(18, 72, 20, 74, 3);
    expect(typeof sw).toBe("string");
    expect(typeof ne).toBe("string");
    expect(sw.length).toBe(3);
    expect(ne.length).toBe(3);
  });
});

// Straight-line track: Mumbai area, ~150m each segment
const TRACK = [
  [72.877, 19.076],
  [72.878, 19.077],
  [72.879, 19.078],
  [72.880, 19.079],
];

describe("simplifyTrack", () => {
  it("preserves first and last points", () => {
    const result = simplifyTrack(TRACK);
    expect(result[0]).toEqual(TRACK[0]);
    expect(result[result.length - 1]).toEqual(TRACK[TRACK.length - 1]);
  });

  it("removes collinear intermediate points", () => {
    // Perfectly collinear points should collapse to just start + end
    const collinear = [
      [0, 0],
      [0.0001, 0],
      [0.0002, 0],
      [0.0003, 0],
    ];
    const result = simplifyTrack(collinear, 0.0001);
    expect(result.length).toBe(2);
  });

  it("returns at least 2 points for any valid input", () => {
    expect(simplifyTrack([[72.877, 19.076], [72.878, 19.077]]).length).toBeGreaterThanOrEqual(2);
    expect(simplifyTrack(TRACK).length).toBeGreaterThanOrEqual(2);
  });
});

describe("interpolatePoint", () => {
  const coords = [[72.877, 19.076], [72.887, 19.086]];

  it("returns the first point at 0m", () => {
    const p = interpolatePoint(coords, 0);
    expect(p.lat).toBeCloseTo(19.076, 4);
    expect(p.lng).toBeCloseTo(72.877, 4);
  });

  it("returns the last point at total distance", () => {
    const totalDist = haversineDistance(19.076, 72.877, 19.086, 72.887);
    const p = interpolatePoint(coords, totalDist);
    expect(p.lat).toBeCloseTo(19.086, 4);
    expect(p.lng).toBeCloseTo(72.887, 4);
  });

  it("correctly interpolates a midpoint", () => {
    const totalDist = haversineDistance(19.076, 72.877, 19.086, 72.887);
    const p = interpolatePoint(coords, totalDist / 2);
    expect(p.lat).toBeCloseTo(19.081, 2);
    expect(p.lng).toBeCloseTo(72.882, 2);
  });
});

describe("sampleTrack", () => {
  it("returns 2 samples for a track shorter than the interval", () => {
    // ~150m track, interval 500m
    const shortTrack = [[72.877, 19.076], [72.878, 19.077]];
    const samples = sampleTrack(shortTrack, 500, 50);
    expect(samples.length).toBe(2);
  });

  it("caps at maxSamples for very long tracks", () => {
    // Build a ~30km track with many segments
    const coords = [];
    for (let i = 0; i <= 300; i++) {
      coords.push([72.877 + i * 0.001, 19.076]);
    }
    const samples = sampleTrack(coords, 100, 50);
    expect(samples.length).toBe(50);
  });

  it("first sample is always at distanceFromStart_m = 0", () => {
    const samples = sampleTrack(TRACK, 500, 50);
    expect(samples[0].distanceFromStart_m).toBe(0);
  });
});
