import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FLASH_ALPHA, SHAKE_MS, SHAKE_REACH } from "../src/game/damageFx";
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
    expect(request.damage).toBe(Number.POSITIVE_INFINITY); // a frame with no blow behind it
    expect(request.aim).toBeNull(); // the scene's own pointer, which is over its densest ore
  });

  test("takes the corner map's zoom, so a level can be looked at (#110)", () => {
    expect(parseArgs(["--map", String(MINIMAP_COVERAGE_WIDE_U)]).map).toBe(MINIMAP_COVERAGE_WIDE_U);
    expect(() => parseArgs(["--map", "0"])).toThrow(/--map/);
    expect(() => parseArgs(["--map", "wide"])).toThrow(/--map/);
  });

  test("takes how long ago the blow landed, so the damage VFX can be looked at (#142)", () => {
    expect(parseArgs(["--damage", "0"]).damage).toBe(0);
    expect(parseArgs(["--damage", String(SHAKE_MS)]).damage).toBe(SHAKE_MS);
    expect(() => parseArgs(["--damage", "-1"])).toThrow(/--damage/);
    expect(() => parseArgs(["--damage", "peak"])).toThrow(/--damage/);
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

  // The aim mark (#154) is struck under the pointer, and a frame has exactly one pointer — so the
  // two backgrounds it has to survive, bare paper and a dense ore patch, are two renders and not one.
  // This is what moves it between them.
  test("puts the pointer where asked, so the aim mark can be looked at on either floor (#154)", () => {
    expect(parseArgs(["--aim", "15790,15750"]).aim).toEqual({ x: 15_790, y: 15_750 });
    expect(() => parseArgs(["--aim", "15790"])).toThrow(/x,y/);
    expect(() => parseArgs(["--aim", "here,there"])).toThrow(/x,y/);
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
  // The swing and the veil are the only marks in the game that are not drawn *in* the world, so no
  // sprite sheet and no spy can show either. This frame is the whole review channel for them: at
  // `--damage 0` the view is thrown its full reach and the veil is at its blackest.
  test("throws the view and veils the frame at the instant of the blow (#142)", () => {
    const source = entrySource(parseArgs(["--damage", "0"]), modules);
    expect(source).toContain(`const shake = {"x":${SHAKE_REACH},"y":0};`);
    expect(source).toContain(`damageFlash: ${FLASH_ALPHA}`);
  });

  test("paints a frame with no blow behind it exactly as the game always has (#142)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain('const shake = {"x":0,"y":0};');
    expect(source).toContain("damageFlash: 0");
  });

  test("carries the bursts, so the mark on impact can be looked at (#115)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain("demoBursts");
    expect(source).toContain("bursts: demoBursts(world, DEMO_NOW)");
  });

  // The puff is procedural ink too, and it is the harder of the two to judge: it stands on bare
  // paper with nothing under it, at a size that has to read as a cloud rather than as a blot.
  test("carries the puffs, so the mark on death can be looked at (#116)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain("demoPuffs");
    expect(source).toContain("puffs: demoPuffs(DEMO_NOW)");
  });

  // The blood is the only *colour* the game draws and the only mark that is filled rather than
  // struck, so it is the mark this channel is most needed for: a spy records that a disc was filled,
  // never whether red on white paper still reads as blood at the faintest band of its fade (#140).
  test("carries the blood, so the trail and the stain can be looked at (#140)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain("demoBlood");
    expect(source).toContain("blood: demoBlood(world, DEMO_NOW)");
  });

  // The aim mark is procedural ink under the pointer, and the one question about it a spy cannot
  // answer is whether it reads over the two floors at once — near-white paper and dense black
  // stipple. The scene aims it at the ore, which is the harder of the two; `--aim` is the paper.
  test("carries the aim mark, so the pointer can be looked at on both floors (#154)", () => {
    expect(entrySource(parseArgs([]), modules)).toContain("aim: DEMO_AIM");
    expect(entrySource(parseArgs(["--aim", "15790,15750"]), modules)).toContain(
      'aim: {"x":15790,"y":15750}',
    );
  });
});
