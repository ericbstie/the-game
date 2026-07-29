import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MINIMAP_COVERAGE_U, MINIMAP_COVERAGE_WIDE_U } from "../src/game/minimap";
import { entrySource, parseArgs } from "./world-frame";

describe("parseArgs", () => {
  test("draws the game as the registry has it when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request.sprites).toEqual({});
    expect(request.out).toBe(join(process.cwd(), "sprite-frame.png"));
    expect(request.dpr).toBe(2);
    expect(request.at).toBeNull();
    expect(request.map).toBe(MINIMAP_COVERAGE_U);
  });

  test("takes the corner map's zoom, so a level can be looked at (#110)", () => {
    expect(parseArgs(["--map", String(MINIMAP_COVERAGE_WIDE_U)]).map).toBe(MINIMAP_COVERAGE_WIDE_U);
    expect(() => parseArgs(["--map", "0"])).toThrow(/--map/);
    expect(() => parseArgs(["--map", "wide"])).toThrow(/--map/);
  });

  test("takes a sprite per name, so a frame can carry more than one at a time", () => {
    const request = parseArgs(["--sprite", "grunt=src/sprite/grunt.ts", "--sprite", "elite=e.ts"]);
    expect(request.sprites).toEqual({
      grunt: join(process.cwd(), "src/sprite/grunt.ts"),
      elite: join(process.cwd(), "e.ts"),
    });
  });

  test("refuses a --sprite that is not name=path rather than rendering an empty frame", () => {
    expect(() => parseArgs(["--sprite", "src/sprite/grunt.ts"])).toThrow(/name=path/);
    expect(() => parseArgs(["--sprite"])).toThrow(/name=path/);
  });

  test("refuses a dpr that could not have come from a real display", () => {
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/dpr/);
    expect(() => parseArgs(["--dpr", "wide"])).toThrow(/dpr/);
  });

  test("puts the camera where asked, so an edge-only sprite can be looked at", () => {
    expect(parseArgs(["--at", "0,0"]).at).toEqual({ x: 0, y: 0 });
    expect(() => parseArgs(["--at", "0"])).toThrow(/x,y/);
  });

  test("refuses an unknown argument rather than silently ignoring it", () => {
    expect(() => parseArgs(["--zoom", "2"])).toThrow(/--zoom/);
  });
});

describe("entrySource", () => {
  const modules = {
    draw: "/repo/draw.ts",
    cache: "/repo/cache.ts",
    world: "/repo/world.ts",
    registry: "/repo/registry.ts",
  };

  test("paints the shipped drawWorld through the transform GameScreen uses", () => {
    const source = entrySource(parseArgs(["--dpr", "3"]), modules);
    expect(source).toContain("...SPRITES"); // the registry is the base, not the command line
    expect(source).toContain('from "/repo/draw.ts"');
    expect(source).toContain("ctx.setTransform(dpr, 0, 0, dpr, -camera.x * dpr");
    expect(source).toContain("const dpr = 3;");
  });

  test("wires each named sprite into a cache keyed by the name the game asks for", () => {
    const source = entrySource(parseArgs(["--sprite", "grunt=/abs/grunt.ts"]), modules);
    expect(source).toContain('import s0 from "/abs/grunt.ts";');
    expect(source).toContain('createSpriteCache({ ...SPRITES, "grunt": s0 })');
  });

  test("draws the corner map at the level it was asked for", () => {
    const source = entrySource(parseArgs(["--map", String(MINIMAP_COVERAGE_WIDE_U)]), modules);
    expect(source).toContain(`minimapCoverage: ${MINIMAP_COVERAGE_WIDE_U}`);
  });

  // The starburst is procedural ink rather than a bake, so no sprite sheet shows it and no spy says
  // whether it reads. This frame is the only channel that puts it at real size over the white spider
  // it is struck on (ADR 0002 §5) — a burst missing from the entry is a mark nobody ever looks at.
  test("carries the bursts, so the mark on impact can be looked at (#115)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain("demoBursts");
    expect(source).toContain("bursts: demoBursts(world, DEMO_NOW)");
  });
});
