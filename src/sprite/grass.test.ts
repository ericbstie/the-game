import { describe, expect, test } from "bun:test";
import grass from "./grass";

// happy-dom returns null from `getContext('2d')`, so the geometry is read off a recorder that
// composes the transforms `draw` applies and reports every path point in the box's own coordinates.
// Whether the tuft reads as grass is the reviewer's call (ADR 0002); where its ink lands is not a
// judgement at all.
type Matrix = [number, number, number, number, number, number];

function pathPoints(size: number, facing: number): [number, number][] {
  const points: [number, number][] = [];
  const stack: Matrix[] = [];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const times = (a: Matrix, b: Matrix): Matrix => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const mark = (x: number, y: number) => {
    points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  };
  const ctx = {
    save: () => stack.push([...m] as Matrix),
    restore: () => {
      m = stack.pop() ?? m;
    },
    scale: (x: number, y: number) => {
      m = times(m, [x, 0, 0, y, 0, 0]);
    },
    translate: (x: number, y: number) => {
      m = times(m, [1, 0, 0, 1, x, y]);
    },
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    moveTo: mark,
    lineTo: mark,
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;

  grass.draw(ctx, size, facing, 0);
  return points;
}

describe("a grass tuft", () => {
  // The blades are hand-placed in a 10 unit design box and the sprite declares an 8 px one (#106),
  // so `draw` has to carry one into the other. Scaling by the declared size instead of the design
  // box leaves the geometry in its original units, which the bake canvas silently crops: the roots
  // — the foot anchor, at y 9.5 of 10 — are the first thing to go.
  test("is scaled into the box the game blits, not the box it was drawn in", () => {
    for (let facing = 0; facing < grass.facings; facing++) {
      const points = pathPoints(grass.size, facing);
      expect(points.length).toBeGreaterThan(0);
      const outside = points.filter(([x, y]) => x < 0 || y < 0 || x > grass.size || y > grass.size);
      expect({ facing, outside }).toEqual({ facing, outside: [] });
    }
  });
});
