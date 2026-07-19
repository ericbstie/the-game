import { describe, expect, test } from "bun:test";
import { interpolateAt, type PosSample } from "./interpolate";

const s = (t: number, x: number, y: number): PosSample => ({ t, pos: { x, y } });

describe("interpolateAt", () => {
  test("returns null for an empty buffer", () => {
    expect(interpolateAt([], 100)).toBeNull();
  });

  test("a single sample is returned at any render time", () => {
    const buf = [s(1000, 5, 9)];
    expect(interpolateAt(buf, 500)).toEqual({ x: 5, y: 9 });
    expect(interpolateAt(buf, 1000)).toEqual({ x: 5, y: 9 });
    expect(interpolateAt(buf, 2000)).toEqual({ x: 5, y: 9 });
  });

  test("LERPs linearly between the two bracketing samples", () => {
    const buf = [s(1000, 0, 0), s(1100, 100, 200)];
    expect(interpolateAt(buf, 1050)).toEqual({ x: 50, y: 100 }); // halfway
    expect(interpolateAt(buf, 1025)).toEqual({ x: 25, y: 50 }); // quarter
  });

  test("clamps to the oldest sample before the buffer starts", () => {
    const buf = [s(1000, 10, 10), s(1100, 20, 20)];
    expect(interpolateAt(buf, 900)).toEqual({ x: 10, y: 10 });
  });

  test("holds the newest sample past the buffer (gap from a missed packet)", () => {
    const buf = [s(1000, 10, 10), s(1100, 20, 20)];
    expect(interpolateAt(buf, 5000)).toEqual({ x: 20, y: 20 });
  });

  test("reconstructs a straight-line path within tolerance", () => {
    // A point moving at constant velocity, sampled every 50 ms.
    const buf = Array.from({ length: 6 }, (_, i) => s(i * 50, i * 50, i * 10));
    // True position at t=175 is x=175, y=35.
    const p = interpolateAt(buf, 175);
    expect(p?.x).toBeCloseTo(175, 6);
    expect(p?.y).toBeCloseTo(35, 6);
  });

  test("tracks a turning path along the sampled polyline", () => {
    // Right for 100 ms, then down for 100 ms — an L-shaped path.
    const buf = [s(0, 0, 0), s(100, 100, 0), s(200, 100, 100)];
    expect(interpolateAt(buf, 50)).toEqual({ x: 50, y: 0 }); // mid first leg
    expect(interpolateAt(buf, 150)).toEqual({ x: 100, y: 50 }); // mid second leg
  });
});
