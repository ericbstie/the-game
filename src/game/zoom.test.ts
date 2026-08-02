import { describe, expect, test } from "bun:test";
import {
  bakeZoom,
  freshZoom,
  wheelZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SETTLE_MS,
} from "./zoom";

// The longest gap `GameScreen`'s render loop still treats as one continuous step, and the floor the
// settle is derived from. Restated rather than imported: the component is a React tree and pulling
// it into this file would drag the whole DOM harness in behind one number.
const MAX_FRAME_MS = 100;

// One notch of a pixel-reporting wheel, which is what Chromium sends.
const NOTCH = 100;
// And of a line-reporting one, which is what Firefox sends on Windows and Linux.
const LINE_NOTCH = 3;
const LINES = 1;

describe("the wheel moves the zoom", () => {
  test("opens at 1:1, so a match nobody touches the wheel in is the game as it always was", () => {
    expect(freshZoom().drawn).toBe(ZOOM_DEFAULT);
    expect(ZOOM_DEFAULT).toBe(1);
  });

  test("wheeling down zooms out and wheeling up zooms in", () => {
    const zoom = freshZoom();
    wheelZoom(zoom, NOTCH, 0, 0);
    expect(zoom.drawn).toBeLessThan(1);
    wheelZoom(zoom, -NOTCH, 0, 0);
    expect(zoom.drawn).toBeCloseTo(1, 12);
  });

  test("holds the author's range and never leaves it, however far the wheel is spun", () => {
    const out = freshZoom();
    for (let i = 0; i < 200; i++) wheelZoom(out, NOTCH, 0, i);
    expect(out.drawn).toBe(ZOOM_MIN);
    const inward = freshZoom();
    for (let i = 0; i < 200; i++) wheelZoom(inward, -NOTCH, 0, i);
    expect(inward.drawn).toBe(ZOOM_MAX);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.5, 3]);
  });

  test("a notch is the same fraction of the picture everywhere in the range", () => {
    // Multiplicative, so the step is read in log space: a step of 0.25 would be a third of the
    // picture at 0.75× and a twelfth of it at 3×.
    const at = (start: number) => {
      const zoom = freshZoom();
      zoom.drawn = start;
      wheelZoom(zoom, NOTCH, 0, 0);
      return zoom.drawn / start;
    };
    expect(at(0.75)).toBeCloseTo(at(2.5), 12);
  });

  test("the whole range is a handful of notches, so it is reachable by hand", () => {
    const zoom = freshZoom();
    let notches = 0;
    while (zoom.drawn > ZOOM_MIN && notches < 100) {
      wheelZoom(zoom, NOTCH, 0, notches);
      notches++;
    }
    expect(notches).toBeLessThanOrEqual(12);
    expect(zoom.drawn).toBe(ZOOM_MIN);
  });

  test("a trackpad's small deltas move it a little, which is what makes it continuous", () => {
    const zoom = freshZoom();
    wheelZoom(zoom, 4, 0, 0);
    expect(zoom.drawn).toBeLessThan(1);
    expect(zoom.drawn).toBeGreaterThan(0.99);
  });

  test("a line-reporting wheel zooms about as far per notch as a pixel-reporting one", () => {
    const pixels = freshZoom();
    wheelZoom(pixels, NOTCH, 0, 0);
    const lines = freshZoom();
    wheelZoom(lines, LINE_NOTCH, LINES, 0);
    // Firefox's three lines against Chromium's hundred pixels: the same wheel, and it must not be a
    // fifteenth of the step on one browser and a whole notch on the other.
    expect(lines.drawn).toBeGreaterThan(pixels.drawn * 0.8);
    expect(lines.drawn).toBeLessThan(1);
  });

  test("a delta that is not a number leaves the zoom exactly where it was", () => {
    const zoom = freshZoom();
    wheelZoom(zoom, Number.NaN, 0, 0);
    wheelZoom(zoom, Number.POSITIVE_INFINITY, 0, 0);
    expect(zoom.drawn).toBe(ZOOM_DEFAULT);
  });
});

// ADR 0008: the bake follows the zoom, and a re-bake burst is 92–315 ms through the shipped path
// (`docs/frame-budget.md`). Paying that on every frame of a gesture is not affordable, so the
// previous bake is held — blitted resampled, which is what every rejected candidate did all the
// time — until the gesture stops.
describe("the bake waits for the gesture to stop", () => {
  test("a zoom nobody has touched bakes at what it draws", () => {
    expect(bakeZoom(freshZoom(), 1_000)).toBe(ZOOM_DEFAULT);
  });

  test("holds the previous bake for the whole gesture", () => {
    const zoom = freshZoom();
    for (let t = 0; t < ZOOM_SETTLE_MS * 4; t += 20) {
      wheelZoom(zoom, NOTCH / 16, 0, t);
      expect(bakeZoom(zoom, t)).toBe(ZOOM_DEFAULT);
    }
    expect(zoom.drawn).toBeLessThan(ZOOM_DEFAULT);
    expect(zoom.drawn).toBeGreaterThan(ZOOM_MIN); // still mid-gesture, not parked against a stop
  });

  test("a wheel spun into a stop settles, because it is no longer moving anything", () => {
    const zoom = freshZoom();
    for (let t = 0; t < 200; t += 20) wheelZoom(zoom, NOTCH, 0, t);
    expect(zoom.drawn).toBe(ZOOM_MIN);
    expect(bakeZoom(zoom, zoom.movedAt + ZOOM_SETTLE_MS)).toBe(ZOOM_MIN);
  });

  test("takes the new bake on the first frame after it settles, and not before", () => {
    const zoom = freshZoom();
    wheelZoom(zoom, NOTCH, 0, 1_000);
    const drawn = zoom.drawn;
    expect(bakeZoom(zoom, 1_000 + ZOOM_SETTLE_MS - 1)).toBe(ZOOM_DEFAULT);
    expect(bakeZoom(zoom, 1_000 + ZOOM_SETTLE_MS)).toBe(drawn);
    expect(bakeZoom(zoom, 1_000 + ZOOM_SETTLE_MS + 1_000)).toBe(drawn);
  });

  test("one settled bake is paid per gesture, not one per notch", () => {
    const zoom = freshZoom();
    const bakes = new Set<number>();
    for (let t = 0; t < 500; t += 16) {
      wheelZoom(zoom, NOTCH / 4, 0, t);
      bakes.add(bakeZoom(zoom, t));
    }
    bakes.add(bakeZoom(zoom, 500 + ZOOM_SETTLE_MS));
    expect(bakes.size).toBe(2); // the one it started on, and the one it stopped on
    expect(bakeZoom(zoom, 500 + ZOOM_SETTLE_MS)).toBe(zoom.drawn);
  });

  test("the settle outlasts the longest gap the render loop treats as one step", () => {
    // `MAX_FRAME_MS` in `GameScreen.tsx`. A gesture is sampled event by event, so a settle under
    // that would let one flick of the wheel settle several times on a frame-starved client and pay
    // a re-bake for each. It is the floor; what sits above it is provisional.
    expect(ZOOM_SETTLE_MS).toBeGreaterThan(MAX_FRAME_MS);
  });
});
