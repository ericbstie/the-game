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
function fakeBakes(s: SpriteSubject, dpr: number) {
  return Array.from({ length: s.frames }, (_, frame) =>
    Array.from(
      { length: s.facings },
      (_, facing) =>
        ({ tag: `${s.name}/${facing}/${frame}@${dpr}` }) as unknown as CanvasImageSource,
    ),
  );
}

function counting() {
  const baked: string[] = [];
  return {
    baked,
    bake: (s: SpriteSubject, dpr: number) => {
      baked.push(`${s.name}@${dpr}`);
      return fakeBakes(s, dpr);
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

  test("bakes a sprite once and serves every later facing and frame from the cache", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    const sprites = cache.source(2);
    sprites("player", 0, 0);
    sprites("player", 5, 1);
    sprites("player", 3, 0);
    expect(baked).toEqual(["player@2"]);
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
    expect(baked).toEqual(["player@2", "grunt@2", "player@3"]);
  });

  test("a pixel ratio that has not moved does not throw the bakes away", () => {
    const { baked, bake } = counting();
    const cache = createSpriteCache({ player: subject("player", 28) }, bake);
    cache.source(2)("player", 0, 0);
    cache.source(2)("player", 0, 0);
    expect(baked).toEqual(["player@2"]);
  });

  test("reports the logical box, not the device-pixel size the sprite was baked at", () => {
    const cache = createSpriteCache({ elite: subject("elite", 48) }, counting().bake);
    expect(cache.source(3)("elite", 0, 0)?.size).toBe(48);
  });

  test("wraps facing and frame, so an unbounded walk counter never indexes off the sheet", () => {
    const cache = createSpriteCache({ player: subject("player", 28) }, counting().bake);
    const sprites = cache.source(1);
    expect(tagOf(sprites("player", 8, 2))).toBe("player/0/0@1");
    expect(tagOf(sprites("player", -1, -1))).toBe("player/7/1@1");
  });

  test("refuses a pixel ratio no display could report, rather than baking a blank sprite", () => {
    const cache = createSpriteCache({ player: subject("player", 28) }, counting().bake);
    expect(() => cache.source(0)).toThrow(/pixel ratio/);
    expect(() => cache.source(Number.NaN)).toThrow(/pixel ratio/);
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
