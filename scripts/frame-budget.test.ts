import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MINIMAP_COVERAGE_U, MINIMAP_COVERAGE_WIDE_U } from "../src/game/minimap";
import { concurrentBursts } from "./burst-ink";
import { entrySource, parseArgs } from "./frame-budget";
import { concurrentPuffs } from "./puff-ink";

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

  // The flag existed before #125 raised `ENEMY_CAP` to 500, so that the frame at that density could be
  // priced rather than guessed at (rule 5). It stays afterwards: the *old* cap is what has to be asked
  // for now, and the two counts have to be measurable side by side for the raise to mean anything.
  test("takes an enemy count, so a cap other than the governor's own can be priced", () => {
    expect(parseArgs(["--enemies", "240"]).enemies).toBe(240);
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

  // #116's puff fires on the connects #115's burst skips, so the two are the same fire priced from
  // either side of `reapDamage`. Rarer, and still in the frame the budget claims to price.
  test("puts the death puffs in the frame it prices, through the shipped mark", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("inkPuff");
    expect(source).toContain("puffs: puffMarks(PUFFS)");
    // The count is derived from the cadences that actually fire, not chosen here (`puff-ink.ts`).
    expect(source).toContain(`const PUFFS = ${concurrentPuffs()};`);
  });

  // A wave clear puts far more puffs up at once than the cadences average to, and #111 is about to
  // move the enemy count they are killing. The standalone ladder is what a retune reads.
  test("prices the puffs on their own, at counts a wave clear reaches", () => {
    const source = entrySource(parseArgs([]));
    expect(source).toContain("puffsMs");
    expect(source).toContain("150: +puffs(150)");
  });
});
