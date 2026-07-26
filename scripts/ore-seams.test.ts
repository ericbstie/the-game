import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, parseArgs } from "./ore-seams";

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
});
