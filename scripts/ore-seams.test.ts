import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, parseArgs } from "./ore-seams";

// `WorldSnapshot` as `src/lobby/protocol.ts:370` declares it. Kept by hand because the entry is a
// string and there is no type to reach for from inside it.
const WORLD_SNAPSHOT_FIELDS = [
  "arena",
  "players",
  "enemies",
  "projectiles",
  "nests",
  "exit",
  "exitRevealed",
  "ore",
  "structures",
];

describe("parseArgs", () => {
  test("measures metal at dpr 1 when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request).toEqual({
      dpr: 1,
      kind: "metal",
      out: join(process.cwd(), "ore-seams-metal.png"),
    });
  });

  test("takes the kind and the ratio the fold is wanted at", () => {
    expect(parseArgs(["--kind", "power", "--dpr", "2"])).toMatchObject({ kind: "power", dpr: 2 });
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--kind", "gold"])).toThrow(/metal or power/);
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/dpr/);
    expect(() => parseArgs(["--zoom", "2"])).toThrow(/--zoom/);
  });
});

describe("entrySource", () => {
  test("measures the shipped drawOre on real generated ore, not a fixture", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("src/game/draw.ts");
    expect(source).toContain("generateOre(ARENA, 1)");
    // The fold is taken over interior tiles only — a tile missing a neighbour has a boundary edge,
    // which is *meant* to be ink-free and would drag the average down and hide a real lattice.
    expect(source).toContain("if (!tileAt(tx - 1, ty) || !tileAt(tx + 1, ty)");
  });

  test("carries the kind through, so --kind power does not silently measure metal", () => {
    expect(entrySource(parseArgs(["--kind", "power"]))).toContain('const KIND = "power"');
  });

  // This literal is inside a template string, so it is the one world `tsc` never checks. #166: it
  // was missing `projectiles`, `drawProjectiles` read `.length` off undefined, and the page died
  // before writing its sink — surfacing as "the page reported no measurements" rather than as the
  // throw. Naming the fields here is what makes that a test failure instead of a mystery.
  //
  // Read out of the literal rather than the whole source, or `ore` matches `generateOre` and the
  // assertion passes with the field gone.
  test("hands drawWorld every field a WorldSnapshot declares", () => {
    const source = entrySource(parseArgs([]));
    const literal = source.match(/drawWorld\(ctx, \{([\s\S]*?)\}, \{ camera/)?.[1];
    expect(literal).toBeString();
    for (const field of WORLD_SNAPSHOT_FIELDS) {
      expect(literal).toMatch(new RegExp(`\\b${field}\\s*[:,]`));
    }
  });
});
