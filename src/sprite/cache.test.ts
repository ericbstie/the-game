import { describe, expect, test } from "bun:test";
import { type BakedSprite, createSpriteCache } from "./cache";
import type { SpriteName } from "./registry";
import type { SpriteSubject } from "./sheet";

// The cache is exercised against a counting stub rather than the real `bakeSubject`, because
// happy-dom returns null from getContext('2d') and a bake needs a real canvas. What is worth
// pinning here is the bookkeeping — when a bake happens, how often, and what invalidates it —
// and that is all resolution-independent. The pixels are the harness's job to look at.

function subject(name: string, size: number, facings = 8, frames = 2): SpriteSubject {
  return { name, size, facings, frames, draw: () => {} };
}

// Stands in for a baked canvas: enough to tell one bake apart from another in an assertion.
// Baking is per **variant** from #87 on, not per sprite — an ore tile's variant index is its
// position cell times its neighbour mask, so it declares thousands of combinations while any one
// frame asks for a few hundred, and baking the grid up front would cost every combination that
// could ever exist.
function counting() {
  const baked: string[] = [];
  return {
    baked,
    bake: (s: SpriteSubject, dpr: number, facing: number, frame: number) => {
      const tag = `${s.name}/${facing}/${frame}@${dpr}`;
      baked.push(tag);
      return { tag } as unknown as CanvasImageSource;
    },
    // The flash variant is derived from a bake rather than drawn, so what it records is which bake it
    // was handed and how wide a rim it was asked for.
    derive: (ink: CanvasImageSource, pixels: number, rim: number) => {
      const tag = `${(ink as unknown as { tag: string }).tag}+flash/${pixels}/${rim}`;
      baked.push(tag);
      return { tag } as unknown as CanvasImageSource;
    },
  };
}

const tagOf = (sprite: BakedSprite | null): string => {
  if (!sprite) throw new Error("expected a baked sprite, got none");
  return (sprite.image as unknown as { tag: string }).tag;
};

describe("createSpriteCache", () => {
  test("has nothing for a sprite whose agent has not landed its file yet", () => {
    const cache = createSpriteCache({}, counting().bake);
    expect(cache.source(2)("player", 0, 0)).toBeNull();
  });

  test("bakes nothing until a sprite is actually asked for", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    cache.source(2);
    expect(baked).toEqual([]);
  });

  test("bakes each variant once and serves every repeat from the cache", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    const sprites = cache.source(2);
    sprites("player", 0, 0);
    sprites("player", 5, 1);
    sprites("player", 3, 0);
    sprites("player", 5, 1); // already in hand
    sprites("player", 0, 0);
    expect(baked).toEqual(["player/0/0@2", "player/5/1@2", "player/3/0@2"]);
  });

  // The point of baking per variant: a sprite may declare far more combinations than a frame ever
  // draws, and only the drawn ones may cost anything.
  test("never bakes a variant nothing asked for, however many the sprite declares", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ "ore-metal": subject("ore-metal", 15, 2304, 1) }, bake);
    cache.source(2)("ore-metal", 1_800, 0);
    expect(baked).toEqual(["ore-metal/1800/0@2"]);
  });

  test("bakes at the device pixel ratio it was asked for", () => {
    const { bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    expect(tagOf(cache.source(3)("player", 1, 0))).toBe("player/1/0@3");
  });

  test("re-bakes everything when the display's pixel ratio changes", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache(
      { player: subject("player", 28), grunt: subject("grunt", 32) },
      bake,
    );
    cache.source(2)("player", 0, 0);
    cache.source(2)("grunt", 0, 0);
    const moved = cache.source(3);
    expect(tagOf(moved("player", 0, 0))).toBe("player/0/0@3");
    expect(baked).toEqual(["player/0/0@2", "grunt/0/0@2", "player/0/0@3"]);
  });

  test("a pixel ratio that has not moved does not throw the bakes away", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    cache.source(2)("player", 0, 0);
    cache.source(2)("player", 0, 0);
    expect(baked).toEqual(["player/0/0@2"]);
  });

  test("reports the logical box, not the device-pixel size the sprite was baked at", () => {
    const cache = createSpriteCache({ elite: subject("elite", 48) }, counting().bake);
    expect(cache.source(3)("elite", 0, 0)?.size).toBe(48);
  });

  // The bake is a whole number of device pixels because a canvas cannot be 22.5 px wide. If the
  // blit went into the nominal box instead, its destination would be half a device pixel off its
  // source, and with smoothing off that is a nearest-neighbour resample of every edge — measured
  // at 45 grey pixels on a pure axis-aligned fill that comes out at 0 when the ratio divides.
  // 1.25 and 1.5 are ordinary Windows display scaling, not exotic.
  test("reports a box that is a whole number of device pixels, even when the ratio does not divide", () => {
    for (const [dpr, size, expected] of [
      [1.5, 15, 23], // an ore tile: 22.5 rounds up
      [1.25, 15, 19],
      [1.25, 30, 38], // a 2×2 building
      [1.5, 75, 113], // the generator
      [1.5, 28, 42], // a character, which divides exactly at every ratio
    ] as const) {
      const cache = createSpriteCache({ player: subject("player", size) }, counting().bake);
      const drawn = cache.source(dpr)("player", 0, 0)?.size ?? 0;
      expect({ dpr, size, device: drawn * dpr }).toEqual({ dpr, size, device: expected });
    }
  });

  test("wraps facing and frame, so an unbounded walk counter never indexes off the sheet", () => {
    const cache = createSpriteCache({ player: subject("player", 28) }, counting().bake);
    const sprites = cache.source(1);
    expect(tagOf(sprites("player", 8, 2))).toBe("player/0/0@1");
    expect(tagOf(sprites("player", -1, -1))).toBe("player/7/1@1");
  });

  test("refuses a scale no frame could be painted at, rather than baking a blank sprite", () => {
    const cache = createSpriteCache({ player: subject("player", 28) }, counting().bake);
    expect(() => cache.source(0)).toThrow(/scale/);
    expect(() => cache.source(Number.NaN)).toThrow(/scale/);
  });

  // ADR 0008: the bake is keyed on `dpr × zoom` and not on `dpr`, so a sprite is always baked at
  // the scale it is drawn at and blitted 1:1 — the rule #77 §5 set, with #92's zoom folded into it.
  // The cache does not learn a second parameter for that; it learns that its one parameter is a
  // product. Every property below is the same property it already had, asked at a zoomed scale.
  describe("under a zoom (#92)", () => {
    test("two ways of reaching one scale are one bake, because the pixels are identical", () => {
      const { baked, bake } = counting();
      const cache = createSpriteCache({ player: subject("player", 28) }, bake);
      cache.source(2 * 1)("player", 0, 0); // dpr 2, drawn 1:1
      cache.source(1 * 2)("player", 0, 0); // dpr 1, zoomed to 2×
      expect(baked).toEqual(["player/0/0@2"]);
    });

    test("re-bakes when the product moves, even though the display has not", () => {
      const { baked, bake } = counting();
      const cache = createSpriteCache({ player: subject("player", 28) }, bake);
      cache.source(2 * 1)("player", 0, 0);
      cache.source(2 * 0.5)("player", 0, 0); // the same display, zoomed out
      expect(baked).toEqual(["player/0/0@2", "player/0/0@1"]);
    });

    test("a sprite keeps its world box at every zoom, so nothing is drawn a different size", () => {
      const cache = createSpriteCache({ elite: subject("elite", 48) }, counting().bake);
      for (const zoom of [0.5, 0.75, 1, 1.5, 2, 3]) {
        const drawn = cache.source(2 * zoom)("elite", 0, 0);
        expect({ zoom, size: drawn?.size }).toEqual({ zoom, size: 48 });
      }
    });

    test("the box is still a whole number of device pixels once the zoom is in the scale", () => {
      // The trap `bakedPixels` exists for, reached by the zoom rather than by Windows scaling: a
      // 15 u ore tile at dpr 2 zoomed to 0.75× is 22.5 device px, and a blit into the nominal box
      // would land half a device pixel off its source.
      const cache = createSpriteCache({ "ore-metal": subject("ore-metal", 15) }, counting().bake);
      for (const [dpr, zoom, device] of [
        [2, 0.75, 23],
        [1, 0.5, 8],
        [2, 3, 90],
        [3, 0.5, 23],
      ] as const) {
        const scale = dpr * zoom;
        const drawn = cache.source(scale)("ore-metal", 0, 0)?.size ?? 0;
        expect({ dpr, zoom, device: drawn * scale }).toEqual({ dpr, zoom, device });
      }
    });
  });
});

// The variant a spider wears for the 90 ms after it is hit (#107). It is *derived* from the ink bake
// rather than drawn — a sprite module hardcodes the ink colour it draws with — and derived only when
// something is actually hit, which is what keeps a second image per facing per frame off the bill for
// the two largest sprites in the set.
describe("the hit flash variant", () => {
  test("is derived from the ink bake of the same facing and frame, never drawn afresh", () => {
    const { baked, bake, derive } = counting();
    const cache = createSpriteCache({ grunt: subject("grunt", 32) }, bake, derive);
    const flash = cache.source(2)("grunt", 3, 1, "flash");
    expect(tagOf(flash)).toBe("grunt/3/1@2+flash/64/2");
    expect(baked).toEqual(["grunt/3/1@2", "grunt/3/1@2+flash/64/2"]);
  });

  test("costs nothing until a spider is hit, and nothing again while it stays hit", () => {
    const { baked, bake, derive } = counting();
    const cache = createSpriteCache({ elite: subject("elite", 48) }, bake, derive);
    const sprites = cache.source(2);
    sprites("elite", 0, 0);
    sprites("elite", 1, 0);
    expect(baked).toEqual(["elite/0/0@2", "elite/1/0@2"]);
    sprites("elite", 1, 0, "flash");
    sprites("elite", 1, 0, "flash"); // the same spider, still flashing, the next frame
    expect(baked).toEqual(["elite/0/0@2", "elite/1/0@2", "elite/1/0@2+flash/96/2"]);
  });

  test("re-derives at the new ratio when the display's pixel ratio changes", () => {
    const { baked, bake, derive } = counting();
    const cache = createSpriteCache({ grunt: subject("grunt", 32) }, bake, derive);
    cache.source(2)("grunt", 0, 0, "flash");
    expect(tagOf(cache.source(3)("grunt", 0, 0, "flash"))).toBe("grunt/0/0@3+flash/96/3");
    expect(baked).toEqual([
      "grunt/0/0@2",
      "grunt/0/0@2+flash/64/2",
      "grunt/0/0@3",
      "grunt/0/0@3+flash/96/3",
    ]);
  });

  // The rim stands *outside* the silhouette, so the variant is a wider box than the bake it came
  // from — and it is `blitOver`'s destination, so it has to be a whole number of device pixels on
  // each side or every edge of a flashing spider is resampled.
  test("is a rim of whole device pixels wider on every side, and never a rim under one", () => {
    const { bake, derive } = counting();
    const cache = createSpriteCache({ grunt: subject("grunt", 32) }, bake, derive);
    for (const [dpr, pixels, rim] of [
      [1, 32, 1],
      [2, 64, 2],
      [3, 96, 3],
      // Windows display scaling. A rim of a fraction of a device pixel would come out grey rather
      // than thin, so it is floored at one whole pixel instead.
      [1.5, 48, 2],
      [1.25, 40, 1],
    ] as const) {
      const sprites = cache.source(dpr);
      expect(tagOf(sprites("grunt", 0, 0, "flash"))).toBe(
        `grunt/0/0@${dpr}+flash/${pixels}/${rim}`,
      );
      const grew =
        (sprites("grunt", 0, 0, "flash")?.size ?? 0) - (sprites("grunt", 0, 0)?.size ?? 0);
      expect(grew).toBeCloseTo((2 * rim) / dpr, 10);
    }
  });
});

describe("SpriteName", () => {
  test("every name the cache is asked for is one the registry knows", () => {
    const names: SpriteName[] = ["player", "grunt", "elite", "nest", "miner", "generator"];
    const cache = createSpriteCache({}, counting().bake);
    const sprites = cache.source(1);
    for (const name of names) expect(sprites(name, 0, 0)).toBeNull();
  });
});
