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

  test("refuses an unknown argument rather than silently ignoring it", () => {
    expect(() => parseArgs(["--fisheye", "2"])).toThrow(/--fisheye/);
  });

  // #92. The frame is the same number of pixels at every zoom — it is the same screen — so what a
  // review of one is about is how much world is in it.
  test("takes the camera's zoom, and opens at the 1:1 every older frame was drawn at", () => {
    expect(parseArgs([]).zoom).toBe(1);
    expect(parseArgs(["--zoom", "0.5"]).zoom).toBe(0.5);
    expect(() => parseArgs(["--zoom", "0"])).toThrow(/--zoom/);
    expect(() => parseArgs(["--zoom", "nope"])).toThrow(/--zoom/);
  });

  test("takes a found door, so the pointer back to it can be looked at (#151)", () => {
    expect(parseArgs([]).door).toBe(false); // a squad that has not found it yet
    expect(parseArgs(["--door"]).door).toBe(true);
  });

  test("takes a crowd, so the worst frame the enemy cap allows can be looked at", () => {
    expect(parseArgs([]).enemies).toBeNull(); // the scene's own handful
    expect(parseArgs(["--enemies", "500"]).enemies).toBe(500);
    expect(() => parseArgs(["--enemies", "0"])).toThrow(/--enemies/);
    expect(() => parseArgs(["--enemies", "12.5"])).toThrow(/--enemies/);
  });
});

describe("entrySource", () => {
  const modules = {
    draw: "/repo/draw.ts",
    cache: "/repo/cache.ts",
    world: "/repo/world.ts",
    registry: "/repo/registry.ts",
    camera: "/repo/camera.ts",
  };

  test("paints the shipped drawWorld through the transform GameScreen uses", () => {
    const source = entrySource(parseArgs(["--dpr", "3"]), modules);
    expect(source).toContain("...SPRITES"); // the registry is the base, not the command line
    expect(source).toContain('from "/repo/draw.ts"');
    expect(source).toContain("ctx.setTransform(scale, 0, 0, scale, -camera.x * scale");
    expect(source).toContain("const dpr = 3;");
    expect(source).toContain("const scale = dpr * zoom;"); // #92: device pixels per world unit
  });

  test("paints the world the screen reaches at the zoom, and bakes the sprites at it", () => {
    const source = entrySource(parseArgs(["--zoom", "0.5"]), modules);
    expect(source).toContain("const zoom = 0.5;");
    expect(source).toContain("worldViewport(DEMO_VIEWPORT, zoom)");
    expect(source).toContain(".source(scale)"); // ADR 0008: keyed on dpr x zoom, not on dpr
    expect(source).toContain("zoom,"); // and handed to drawWorld, for the snap and the corner map
  });

  test("stocks the frame with a crowd only when one was asked for", () => {
    expect(entrySource(parseArgs([]), modules)).toContain("const world = demoWorld();");
    expect(entrySource(parseArgs(["--enemies", "500"]), modules)).toContain(
      "demoCrowd(demoWorld(), 500, viewport)",
    );
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
  // The reveal is a session latch the server flips, so no arrangement of a hand-built scene can
  // produce it: the demo squad stands 15,400 u from its door and has never been near enough. Setting
  // it here is the only way this frame can show the pointer at all (#151).
  test("stages a found door only when one was asked for", () => {
    expect(entrySource(parseArgs(["--door"]), modules)).toContain("world.exitRevealed = true;");
    expect(entrySource(parseArgs([]), modules)).toContain("world.exitRevealed = false;");
  });

  test("carries the blood, so the trail and the stain can be looked at (#140)", () => {
    const source = entrySource(parseArgs([]), modules);
    expect(source).toContain("demoBlood");
    expect(source).toContain("blood: demoBlood(world, DEMO_NOW)");
  });
});
