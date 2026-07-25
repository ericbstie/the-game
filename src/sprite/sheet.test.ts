import { describe, expect, test } from "bun:test";
import { layoutSheet, measurePixels, type SpriteSubject } from "./sheet";

function fixture(overrides: Partial<SpriteSubject> = {}): SpriteSubject {
  return { name: "fixture", size: 28, facings: 8, frames: 2, draw: () => {}, ...overrides };
}

function bands(layout: ReturnType<typeof layoutSheet>) {
  return [layout.contact, layout.floor, layout.magnified, layout.flip].filter(
    (band) => band !== null,
  );
}

describe("layoutSheet", () => {
  test("gives every subject the same width, so sheets compare across agents", () => {
    expect(layoutSheet(fixture({ size: 48 })).width).toBe(layoutSheet(fixture()).width);
    expect(layoutSheet(fixture({ facings: 1, frames: 1 })).width).toBe(
      layoutSheet(fixture()).width,
    );
  });

  test("keeps every band inside the sheet, with room above it for its label", () => {
    const layout = layoutSheet(fixture());
    for (const band of bands(layout)) {
      expect(band.x).toBeGreaterThan(0);
      expect(band.x + band.width).toBeLessThanOrEqual(layout.width);
      expect(band.y).toBeGreaterThan(0);
      expect(band.y + band.height).toBeLessThanOrEqual(layout.height);
      expect(band.label).not.toBe("");
    }
  });

  test("stacks the bands in review order without overlapping", () => {
    const ordered = bands(layoutSheet(fixture()));
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].y).toBeGreaterThan(ordered[i - 1].y + ordered[i - 1].height);
    }
  });

  test("gives the contact grid one column per facing when they fit", () => {
    expect(layoutSheet(fixture()).contactColumns).toBe(8);
  });

  test("wraps the contact grid rather than overflow when a row of facings will not fit", () => {
    const layout = layoutSheet(fixture({ size: 200 }));
    expect(layout.contactColumns).toBeLessThan(8);
    expect(layout.contact.width).toBeLessThanOrEqual(layout.width);
  });

  test("grows the contact grid by one row group per frame", () => {
    const one = layoutSheet(fixture({ frames: 1 })).contact.height;
    expect(layoutSheet(fixture({ frames: 2 })).contact.height).toBeGreaterThan(one);
  });

  test("drops the flip strip when there is only one frame to flip between", () => {
    expect(layoutSheet(fixture({ frames: 1 })).flip).toBeNull();
    expect(layoutSheet(fixture({ frames: 2 })).flip).not.toBeNull();
    expect(layoutSheet(fixture({ frames: 1 })).height).toBeLessThan(
      layoutSheet(fixture({ frames: 2 })).height,
    );
  });

  test("magnifies a small sprite hard and a big one only as far as the width allows", () => {
    const small = layoutSheet(fixture({ size: 28 }));
    const big = layoutSheet(fixture({ size: 200 }));
    expect(small.magnifyScale).toBeGreaterThan(big.magnifyScale);
    expect(big.magnifyScale).toBeGreaterThanOrEqual(2);
    expect(small.magnified.height).toBe(28 * small.magnifyScale);
  });

  test("magnifies by a whole number, so nearest-neighbour lands on whole pixels", () => {
    expect(layoutSheet(fixture({ size: 33 })).magnifyScale % 1).toBe(0);
  });

  test("rejects a subject that cannot be laid out", () => {
    expect(() => layoutSheet(fixture({ size: 0 }))).toThrow();
    expect(() => layoutSheet(fixture({ facings: 0 }))).toThrow();
    expect(() => layoutSheet(fixture({ frames: 0 }))).toThrow();
    expect(() => layoutSheet(fixture({ size: 12.5 }))).toThrow();
  });
});

// One RGBA pixel per argument row, in the order the canvas hands them over.
function pixels(...rows: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(rows.flat());
}

describe("measurePixels", () => {
  test("counts opaque ink apart from anti-aliased grey and from clear", () => {
    const facts = measurePixels(
      pixels([0, 0, 0, 255], [128, 128, 128, 255], [0, 0, 0, 120], [0, 0, 0, 0]),
      2,
      2,
    );
    expect(facts.ink).toBe(1);
    expect(facts.grey).toBe(2); // an opaque mid-grey and a translucent black both read as grey
    expect(facts.clear).toBe(1);
  });

  test("bounds the covered pixels, ignoring the clear ones around them", () => {
    const facts = measurePixels(
      pixels([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 255]),
      2,
      2,
    );
    expect(facts.bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  test("reports no bounds for a bake that drew nothing", () => {
    expect(measurePixels(pixels([0, 0, 0, 0]), 1, 1).bounds).toBeNull();
  });
});
