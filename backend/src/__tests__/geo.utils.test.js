const {
  isValidLatLng,
  haversineDistance,
  boundingBoxArea,
  toGeohash,
  getBoundingBoxGeohashes,
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
