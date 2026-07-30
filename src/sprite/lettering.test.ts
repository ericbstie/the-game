import { describe, expect, test } from "bun:test";
import lettering, { WORDS } from "./lettering";

// happy-dom returns null from `getContext('2d')`, so the geometry is read off a recorder that
// composes the transforms `draw` applies and reports every path point in the box's own coordinates,
// alongside the ink each stroke went out in. Whether a word reads as 1930s hand lettering is the
// reviewer's call (ADR 0002); where its ink lands, and that it is a *drawing* rather than a written
// word, are not judgements at all.
type Matrix = [number, number, number, number, number, number];

interface Recorded {
  points: [number, number][];
  paints: string[]; // every colour a fill or a stroke actually went out in
  // How many subpaths each path held, in the order the paths were opened. A path is one `beginPath`
  // and a subpath is one `moveTo`, so this is "how many separate pen strokes went into each pass" —
  // which is what tells the rays apart from the lettering without the test knowing where either is.
  passes: number[];
  wrote: number; // calls that would put a typeset glyph on the canvas
}

function record(size: number, facing: number): Recorded {
  const points: [number, number][] = [];
  const paints: string[] = [];
  const passes: number[] = [];
  let wrote = 0;
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
  const ctx: Record<string, unknown> = {
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
    rotate: (a: number) => {
      m = times(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    beginPath: () => passes.push(0),
    closePath: () => {},
    moveTo: (x: number, y: number) => {
      passes[passes.length - 1]++;
      mark(x, y);
    },
    lineTo: mark,
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      mark(cx, cy);
      mark(x, y);
    },
    fill: () => paints.push(String(ctx.fillStyle)),
    stroke: () => paints.push(String(ctx.strokeStyle)),
    fillText: () => {
      wrote++;
    },
    strokeText: () => {
      wrote++;
    },
    fillStyle: "",
    strokeStyle: "",
  };

  lettering.draw(ctx as unknown as CanvasRenderingContext2D, size, facing, 0);
  return { points, paints, passes, wrote };
}

// How many pen strokes each letterform is drawn with. Written out here rather than read off the
// module, because it is a claim about the *drawing* — a P is a stem and a bowl, an O is one closed
// loop, a B is a stem and two bowls — and a test that took the number from the code it is checking
// could not fail when that code changed it.
const STROKES: Record<string, number> = { P: 2, O: 1, W: 1, Z: 1, A: 2, B: 3, M: 1 };

describe("the lettered word popping over an impact", () => {
  // The whole shape of the sprite side of #79: a hand-lettered word is a *drawn shape*, so the box
  // has to be reachable by a bake and by nothing else. A `fillText` here would satisfy every other
  // assertion in this file and be the one thing ADR 0001's grant does not cover — the grant is for
  // the words, not for a typeface in the arena.
  test("is drawn and never written", () => {
    for (let facing = 0; facing < lettering.facings; facing++) {
      expect({ facing, wrote: record(lettering.size, facing).wrote }).toEqual({ facing, wrote: 0 });
    }
  });

  test("draws one variant for every word in the set, and nothing spare", () => {
    expect(lettering.facings).toBe(WORDS.length);
    expect(WORDS.length).toBeGreaterThan(1);
    expect(lettering.frames).toBe(1);
  });

  // The rays are laid out against one figure for the word's extent, so a word of a different length
  // would letter itself out past them and be crossed by the ones the layout thought were clear. It is
  // held here rather than made to work for any length, because the box has no room for a fourth
  // letter anyway — see `SIZE`.
  test("holds every word to one length, which is what the rays are laid out against", () => {
    expect(new Set(WORDS.map((word) => word.length)).size).toBe(1);
  });

  // The words are the point of the ticket, so two of them coming out as the same drawing would be a
  // set of one wearing four labels. Two things are held, and the second is the one that catches a
  // sprite that quietly ignores the variant it was asked for: every bake is a distinct drawing, *and*
  // the letters in it are the letters of that word. The letter count is read off the strokes each
  // glyph declares, so it is the word's own signature rather than a number copied out here.
  test("no two words are the same drawing, and each is the word it was asked for", () => {
    const drawn = WORDS.map((_, facing) => JSON.stringify(record(lettering.size, facing).points));
    expect(new Set(drawn).size).toBe(WORDS.length);
    for (let facing = 0; facing < WORDS.length; facing++) {
      const { passes } = record(lettering.size, facing);
      // Three passes: the rays, then the word's paper, then the word's ink. The two lettering passes
      // are one layout struck twice, so they hold the same strokes — and that count is the word's own
      // signature, which is what catches a bake that quietly draws the same word for every variant.
      const strokes = [...WORDS[facing]].reduce((n, letter) => n + STROKES[letter], 0);
      expect({ facing, passes }).toEqual({ facing, passes: [passes[0], strokes, strokes] });
      expect(passes[0]).toBeGreaterThan(0); // the rays
    }
  });

  // The floor is white paper with no greys (#72), and the set is black ink with two granted colours
  // (#76) — neither of them here. Paper is in the list because the field the letters sit on *is*
  // paper: unoutlined ink over an ink spider is invisible, which is why a name and a miner's `+1`
  // are cut out of paper the same way.
  // The order is asserted along with the colours, because it is load-bearing rather than incidental:
  // the rays go down first so the word's paper trims their inner ends, and the paper goes down before
  // the ink so a letter's ink survives its neighbour's paper. Struck the other way round, the whole
  // word's ink is erased by the whole word's paper and the bake comes out blank.
  test("is struck in ink on paper and in nothing else, in that order", () => {
    for (let facing = 0; facing < lettering.facings; facing++) {
      const paints = record(lettering.size, facing).paints;
      expect({ facing, paints }).toEqual({ facing, paints: ["#000", "#fff", "#000"] });
    }
  });

  // The word is composed in its own design box and scaled into whatever box the game blits, exactly
  // as a tuft is (#106). Ink outside that box is ink the bake canvas crops without a word.
  test("keeps every mark inside the box the game blits it into", () => {
    for (let facing = 0; facing < lettering.facings; facing++) {
      const points = record(lettering.size, facing).points;
      expect(points.length).toBeGreaterThan(0);
      const outside = points.filter(
        ([x, y]) => x < 0 || y < 0 || x > lettering.size || y > lettering.size,
      );
      expect({ facing, outside }).toEqual({ facing, outside: [] });
    }
  });

  // The one thing the box cannot be free about. A word is struck centred on the blow, and a damaged
  // spider carries the game's only damage readout directly above its sprite (#81) — so a box that
  // reached higher than a grunt's bar sits would cover the readout at the moment the player is
  // reading it. #115 solved the same problem by putting its long spikes on the diagonal; a blitted
  // box has no diagonal to hide in, so the box itself is what has to clear it.
  test("draws in a box that fits under a damaged grunt's health bar", () => {
    // GRUNT_RADIUS 16 puts the bar's underside 19 above the mark (`BAR_GAP` 3 + `BAR_HEIGHT` 4),
    // and the box reaches half its own height above it.
    expect(lettering.size / 2).toBeLessThan(19);
  });
});
