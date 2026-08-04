import { describe, expect, test } from "bun:test";
import spiderman from "./spiderman";

// happy-dom returns null from `getContext('2d')`, so the drawing is read off a recorder. What is
// checked here is not whether the creature reads as a spider — that is the reviewer's call
// (ADR 0002) — but the one structural property the silhouette depends on.
//
// #171: eleven separate fills meant every join between two parts composited against itself, and two
// half-covered composites do not sum to opaque. The whole animal is one path filled once, and the
// union is only a union while every subpath winds the same way: a counter-wound arc would punch a
// hole straight through the mass under the nonzero rule.

interface Recorded {
  beginPath: number;
  fill: number;
  stroke: number;
  arcs: number;
  counterWound: number;
}

function record(facing: number, frame: number): Recorded {
  const seen: Recorded = { beginPath: 0, fill: 0, stroke: 0, arcs: 0, counterWound: 0 };
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    beginPath: () => {
      seen.beginPath++;
    },
    closePath: () => {},
    fill: () => {
      seen.fill++;
    },
    stroke: () => {
      seen.stroke++;
    },
    moveTo: () => {},
    lineTo: () => {},
    arc: (
      _x: number,
      _y: number,
      _r: number,
      _from: number,
      _to: number,
      anticlockwise?: boolean,
    ) => {
      seen.arcs++;
      if (anticlockwise) seen.counterWound++;
    },
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
  } as unknown as CanvasRenderingContext2D;

  spiderman.draw(ctx, spiderman.size, facing, frame);
  return seen;
}

const every: [number, number][] = [];
for (let facing = 0; facing < spiderman.facings; facing++) {
  for (let frame = 0; frame < spiderman.frames; frame++) every.push([facing, frame]);
}

describe("spiderman", () => {
  test("draws the whole animal as one filled path", () => {
    for (const [facing, frame] of every) {
      const seen = record(facing, frame);
      expect({ facing, frame, ...seen }).toMatchObject({ beginPath: 1, fill: 1 });
    }
  });

  // A stroke would feather every edge on the creature rather than only the join that needed closing.
  test("lays no stroke at all", () => {
    for (const [facing, frame] of every) {
      expect({ facing, frame, stroke: record(facing, frame).stroke }).toMatchObject({ stroke: 0 });
    }
  });

  test("winds every disc the same way, so the union cannot become a hole", () => {
    for (const [facing, frame] of every) {
      const seen = record(facing, frame);
      expect(seen.arcs).toBeGreaterThan(0);
      expect({ facing, frame, counterWound: seen.counterWound }).toMatchObject({ counterWound: 0 });
    }
  });
});
