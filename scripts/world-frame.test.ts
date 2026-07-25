import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, parseArgs } from "./world-frame";

describe("parseArgs", () => {
  test("stands the calibration pattern in for the player when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request.sprites).toEqual({ player: join(process.cwd(), "src/sprite/calibration.ts") });
    expect(request.out).toBe(join(process.cwd(), "sprite-frame.png"));
    expect(request.dpr).toBe(2);
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

  test("refuses an unknown argument rather than silently ignoring it", () => {
    expect(() => parseArgs(["--zoom", "2"])).toThrow(/--zoom/);
  });
});

describe("entrySource", () => {
  const modules = { draw: "/repo/draw.ts", cache: "/repo/cache.ts", world: "/repo/world.ts" };

  test("paints the shipped drawWorld through the transform GameScreen uses", () => {
    const source = entrySource(parseArgs(["--dpr", "3"]), modules);
    expect(source).toContain('from "/repo/draw.ts"');
    expect(source).toContain("ctx.setTransform(dpr, 0, 0, dpr, -DEMO_CAMERA.x * dpr");
    expect(source).toContain("const dpr = 3;");
  });

  test("wires each named sprite into a cache keyed by the name the game asks for", () => {
    const source = entrySource(parseArgs(["--sprite", "grunt=/abs/grunt.ts"]), modules);
    expect(source).toContain('import s0 from "/abs/grunt.ts";');
    expect(source).toContain('createSpriteCache({ "grunt": s0 })');
  });
});
