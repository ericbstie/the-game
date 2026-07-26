import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, parseArgs } from "./world-frame";

describe("parseArgs", () => {
  test("draws the game as the registry has it when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request.sprites).toEqual({});
    expect(request.out).toBe(join(process.cwd(), "sprite-frame.png"));
    expect(request.dpr).toBe(2);
    expect(request.at).toBeNull();
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
});
