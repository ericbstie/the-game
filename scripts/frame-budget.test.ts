import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { entrySource, parseArgs } from "./frame-budget";

describe("parseArgs", () => {
  test("measures the registry as it stands when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request.sprites).toEqual({});
    expect(request.out).toBe(join(process.cwd(), "frame-budget.png"));
    expect(request.dpr).toBe(2);
  });

  test("layers in art that has not landed, so the budget can be measured before it does", () => {
    const request = parseArgs(["--sprite", "grass=src/sprite/grass.ts"]);
    expect(request.sprites).toEqual({ grass: join(process.cwd(), "src/sprite/grass.ts") });
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--sprite", "src/sprite/grass.ts"])).toThrow(/name=path/);
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/dpr/);
    expect(() => parseArgs(["--zoom", "2"])).toThrow(/--zoom/);
  });
});

describe("entrySource", () => {
  test("measures the shipped drawWorld, not a copy of it", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("src/game/draw.ts");
    expect(source).toContain("drawWorld(ctx, full, opts)");
    // The cap is read from the simulation, so the worst case cannot drift from the governor.
    expect(source).toContain("ENEMY_CAP");
    expect(source).toContain("build(ENEMY_CAP, STRUCTURES, true)");
  });

  test("forces a rasterisation per iteration, or it would time queueing rather than painting", () => {
    expect(entrySource(parseArgs([]))).toContain("ctx.getImageData(0, 0, 1, 1)");
  });

  test("puts every entity inside the viewport, so the worst case is not quietly culled", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("CAM.x + r() * VIEW.width");
  });
});
