import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MINIMAP_COVERAGE_U, MINIMAP_COVERAGE_WIDE_U } from "../src/game/minimap";
import { concurrentBursts } from "./burst-ink";
import { entrySource, parseArgs } from "./frame-budget";

describe("parseArgs", () => {
  test("measures the registry as it stands when nothing is asked for", () => {
    const request = parseArgs([]);
    expect(request.sprites).toEqual({});
    expect(request.out).toBe(join(process.cwd(), "frame-budget.png"));
    expect(request.dpr).toBe(2);
    // The level the map opens at, so a plain run measures what the published budget measured.
    expect(request.map).toBe(MINIMAP_COVERAGE_U);
  });

  test("takes the corner map's zoom, so the costliest level can be priced (#110)", () => {
    expect(parseArgs(["--map", String(MINIMAP_COVERAGE_WIDE_U)]).map).toBe(MINIMAP_COVERAGE_WIDE_U);
    expect(() => parseArgs(["--map", "0"])).toThrow(/--map/);
    expect(() => parseArgs(["--map", "wide"])).toThrow(/--map/);
  });

  // #111 raises `ENEMY_CAP` to 500 and has not landed. A frame that has to hold at that density can
  // be priced now or guessed at later, and guessing is what rule 5 of the budget exists to stop.
  test("takes an enemy count, so a cap the governor has not been raised to yet can be priced", () => {
    expect(parseArgs(["--enemies", "500"]).enemies).toBe(500);
    expect(parseArgs([]).enemies).toBeNull(); // the governor's own cap, whatever it is today
    expect(() => parseArgs(["--enemies", "0"])).toThrow(/--enemies/);
    expect(() => parseArgs(["--enemies", "lots"])).toThrow(/--enemies/);
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

  test("builds the count it was asked for instead, when it was asked for one", () => {
    expect(entrySource(parseArgs(["--enemies", "500"]))).toContain("build(500, STRUCTURES, true)");
  });

  // A probe that strokes its own plain line prices the treatment the game replaced, which is how a
  // harness comes to disagree with the frame it is meant to explain (#110).
  test("prices a shot through the treatment the game strikes, not a plain line", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("src/game/fx.ts");
    expect(source).toContain("speedLines(p.pos, e.pos)");
  });

  test("forces a rasterisation per iteration, or it would time queueing rather than painting", () => {
    expect(entrySource(parseArgs([]))).toContain("ctx.getImageData(0, 0, 1, 1)");
  });

  test("puts every entity inside the viewport, so the worst case is not quietly culled", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("CAM.x + r() * VIEW.width");
  });

  test("draws the corner map at the level it was asked for", () => {
    const source = entrySource(parseArgs(["--map", String(MINIMAP_COVERAGE_WIDE_U)]));
    expect(source).toContain(`minimapCoverage: ${MINIMAP_COVERAGE_WIDE_U}`);
  });

  // The map's ore layer is bounded to the window, so a scene with ore only under the camera draws
  // the same handful of marks at every level and no level can be dearer than another (#110). The
  // arena's own field is what makes the widest window a wider window onto something.
  test("lays the arena's real ore field, not only the patches under the camera", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("generateOre");
  });

  // #115's burst fires on every connect rather than on every death, so it is the effect most exposed
  // to the per-stroke cost rule 1 states. A budget that does not draw it is pricing a frame the game
  // stopped drawing.
  test("puts the impact bursts in the frame it prices, through the shipped mark", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("starburst");
    expect(source).toContain("bursts: burstMarks(BURSTS)");
    // The count is derived from the cadences that actually fire, not chosen here (`burst-ink.ts`).
    expect(source).toContain(`const BURSTS = ${concurrentBursts()};`);
  });

  // The whole-frame instrument could not resolve #114's 1.3 ms layer and will not resolve this
  // smaller one either. The standalone probe is what answers it, and it has to price counts the
  // cadences cannot reach today — otherwise a retune has nothing to read.
  test("prices the bursts on their own, at counts a retune could reach", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("burstsMs");
    expect(source).toContain("150: +bursts(150)");
  });
});
