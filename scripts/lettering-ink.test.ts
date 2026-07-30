import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { concurrentBursts } from "./burst-ink";
import { concurrentLettering, entrySource, format, parseArgs, type Reading } from "./lettering-ink";
import { concurrentPuffs } from "./puff-ink";

describe("parseArgs", () => {
  // #79 asks for the ink at dpr 1, 2 and 3, so a plain run has to answer at all three or the posted
  // figure is one resolution reported as if it held at every one.
  test("measures all three resolutions when it is not told which", () => {
    const request = parseArgs([]);
    expect(request.dprs).toEqual([1, 2, 3]);
    expect(request.out).toBe(join(process.cwd(), "lettering-ink.png"));
  });

  test("takes as many resolutions as it is given, rather than the last one", () => {
    expect(parseArgs(["--dpr", "1", "--dpr", "2.5"]).dprs).toEqual([1, 2.5]);
  });

  test("refuses arguments that would silently measure the wrong thing", () => {
    expect(() => parseArgs(["--dpr", "0"])).toThrow(/--dpr/);
    expect(() => parseArgs(["--words", "-1"])).toThrow(/--words/);
    expect(() => parseArgs(["--scale", "2"])).toThrow(/--scale/);
  });

  test("defaults the screen's word count to what the cadences actually put up", () => {
    expect(parseArgs([]).words).toBe(concurrentLettering());
  });
});

// The count the ticket's anti-narrowing clause is answered at. Derived rather than picked, so a
// retune of a cadence, a damage figure or either mark's lifetime moves it instead of leaving a stale
// number in a document.
describe("concurrentLettering", () => {
  // Lettering rides #115's marks and #116's marks rather than a list of its own, so the words on
  // screen are one per mark of either kind and the count is the two counts added. Stated as an
  // equality on purpose: if a word ever gets a lifetime of its own, this is the assertion that
  // fails rather than a figure that quietly stops being true.
  test("is one word per mark of either kind, hits and deaths together", () => {
    expect(concurrentLettering()).toBe(concurrentBursts() + concurrentPuffs());
  });

  // Both events, and this is the whole of what makes #79 heavier than either mark alone.
  test("counts more words than either event puts up on its own", () => {
    expect(concurrentLettering()).toBeGreaterThan(concurrentBursts());
    expect(concurrentLettering()).toBeGreaterThan(concurrentPuffs());
  });
});

describe("entrySource", () => {
  // The failure this exists to stop is the one #110 named and b71f155 fixed in the frame harness: a
  // probe that draws something other than the thing it is asked about. For a *baked* mark that is a
  // sharper risk than for a stroked one — a probe could draw the word itself and measure a drawing
  // the game never blits — so what is pinned here is that it goes through the shipped cache.
  test("blits the shipped bake through the shipped cache, not a copy of the drawing", () => {
    const source = entrySource(1, 5);
    expect(source).toContain("src/sprite/lettering.ts");
    expect(source).toContain("src/sprite/cache.ts");
    expect(source).toContain("src/sprite/registry.ts");
    expect(source).toContain("createSpriteCache(SPRITES).source(DPR)");
    expect(source).toContain('source("lettering", word, 0)');
  });

  // #120's lesson, as an assertion. A sprite measured in its own box is only what the player sees
  // when the box and the blit agree, so the probe takes the box off the cache — `BakedSprite.size`,
  // which is `bakedPixels(size, dpr) / dpr` and not the nominal figure — rather than assuming it.
  test("blits into the box the cache hands over, at the size the game draws it", () => {
    const source = entrySource(2, 5);
    expect(source).toContain("sprite.size / 2, sprite.size, sprite.size");
    expect(source).toContain("ctx.setTransform(DPR, 0, 0, DPR, 0, 0)");
  });

  // The mix on screen has to be the mix a player sees, which means the game's own rule picks each
  // word. A probe that cycled the set in order would measure four equal shares of a distribution
  // `letteringAt` does not necessarily produce.
  test("letters the screen with the game's own rule rather than in order", () => {
    expect(entrySource(1, 5)).toContain("letteringAt(at, 1_000)");
  });

  // A word's ink means nothing on its own. The shot's mark is the thing in the frame the budget
  // already prices, so it is what the word is reported against — and it is what makes this figure
  // comparable to #115's and #116's rather than a third scale.
  test("strikes a shot's mark beside it, for scale", () => {
    const source = entrySource(1, 5);
    expect(source).toContain("speedLines(");
    expect(source).toContain("ctx.lineWidth = SHOT_WIDTH");
  });

  test("measures at the resolution and the word count it was asked for", () => {
    expect(entrySource(3, 40)).toContain("const DPR = 3;");
    expect(entrySource(3, 40)).toContain("const WORD_COUNT = 40;");
  });

  // Anti-aliasing is half the question, so the answer cannot be read off one pixel being on or off.
  test("counts a partly covered pixel as the part of it that is inked", () => {
    expect(entrySource(1, 5)).toContain("(255 - (px[i] + px[i + 1] + px[i + 2]) / 3) / 255");
  });

  // The wall-of-ink question is about a screen, so it is asked on the viewport the frame budget
  // measures — a word count on some other canvas is a share of the wrong thing.
  test("asks the screen question on the frame budget's own viewport", () => {
    expect(entrySource(2, 5)).toContain("const VIEW = { width: 800, height: 600 }");
  });
});

describe("format", () => {
  const readings: Reading[] = [
    {
      dpr: 2,
      bakes: [
        { word: 0, box: 72, ink: 800, inked: 1_600, solid: 800 },
        { word: 1, box: 72, ink: 1_200, inked: 2_400, solid: 1_200 },
      ],
      shot: { ink: 5_000, inked: 6_000, solid: 4_000, strokes: 9 },
      screen: { words: 5, ink: 4_800, inked: 9_600, solid: 4_800, pixels: 1_920_000 },
    },
  ];

  test("reports the word against the mark the budget already prices", () => {
    expect(format(readings)).toContain("20.0%");
  });

  // Four words are four drawings and they do not weigh the same. A mean on its own hides the one
  // that would be the first to read as too heavy, so the heaviest bake is reported beside it.
  test("names the heaviest bake as well as the average one", () => {
    expect(format(readings)).toContain("1200");
  });

  // The whole question the ticket's anti-narrowing clause asks: what share of the screen the words at
  // density actually cover. A report that gives the ink without the paper it is on cannot answer it.
  test("says what share of the screen the words at density ink", () => {
    expect(format(readings)).toContain("0.25%");
  });
});
