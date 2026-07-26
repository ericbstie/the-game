import type { SpriteName } from "./registry";
import { bakedPixels, bakeOne, type SpriteSubject } from "./sheet";

// The draw-time side of the sprite pipeline: baked offscreen canvases the render loop blits
// instead of drawing shapes.
//
// The one rule that shapes all of it comes from #77 §5. `GameScreen` paints through
// `setTransform(dpr, …)`, so a sprite baked at its logical size is *upscaled* on a HiDPI display
// and reads as a smudge — at 28 px, 70% of a contour comes out grey. Sprites are therefore baked
// at `size × dpr` and blitted into a box exactly that many device pixels wide, which is one device
// pixel per baked pixel and so nothing to resample (see `BakedSprite.size`, which is what carries
// that box and is not always the nominal one).
// That makes the device pixel ratio part of a bake's identity: when it changes, every bake in
// hand is the wrong resolution, so the cache empties itself rather than keeping a second copy of
// the whole sprite set for a display the player is no longer looking at.
//
// Baking is lazy, per sprite. Nothing is baked until something asks to draw it, so a match that
// never spawns an elite never pays for one, and the fifteen sprite modules can land one at a time
// without the first frame growing to meet them.

// What the render loop needs to put a sprite on screen: the baked image, and the box in CSS px to
// blit it into.
//
// `size` is **not** always the subject's nominal box. It is `bakedPixels(size, dpr) / dpr` — the
// CSS width that comes out to exactly the bake's device-pixel width, so the blit is 1:1 and there
// is nothing to resample. Those agree whenever `size × dpr` is a whole number, which is every
// character at every ratio, but not a 15 px ore tile at 1.25× or 1.5× (Windows display scaling),
// where the nominal box would land the destination half a device pixel off its source and turn
// every edge grey. A sprite can therefore draw up to half a device pixel larger than its nominal
// box; that is the cheaper of the two errors, and it is invisible.
export interface BakedSprite {
  image: CanvasImageSource;
  size: number;
}

// Looking up a sprite is the whole seam between produced art and `drawWorld`: one call, and null
// for anything not yet drawn. `drawWorld` takes one of these, so a test can hand it a stub and a
// screenshot harness can hand it a single sprite under review.
export type SpriteSource = (name: SpriteName, facing: number, frame: number) => BakedSprite | null;

export interface SpriteCache {
  // The sprites as they should be drawn at this device pixel ratio. Called once a frame; a ratio
  // that has not moved is free.
  source(dpr: number): SpriteSource;
}

type Bake = (
  subject: SpriteSubject,
  dpr: number,
  facing: number,
  frame: number,
) => CanvasImageSource;

// `bake` is injected so the bookkeeping can be tested under `bun test`, where happy-dom has no
// canvas at all and a real bake is impossible. It defaults to the harness's own `bakeOne`, which
// is what already encodes the bake-at-`size × dpr` rule.
//
// Baking is lazy per **variant**, not per sprite. That matters from #87 on: an ore tile's variant
// index is a product — its position cell times its neighbour-occupancy mask — so it declares
// thousands of combinations while any one frame asks for a few hundred. Baking a sprite's whole
// grid on first use would have made the first ore tile on screen cost every combination that could
// ever exist. This way the bill tracks what is actually drawn.
export function createSpriteCache(
  subjects: Partial<Record<SpriteName, SpriteSubject>>,
  bake: Bake = bakeOne,
): SpriteCache {
  let baked = new Map<string, CanvasImageSource>();
  let bakedDpr = 0;

  const source: SpriteSource = (name, facing, frame) => {
    const subject = subjects[name];
    if (!subject) return null;
    const f = wrap(facing, subject.facings);
    const n = wrap(frame, subject.frames);
    const key = `${name}/${f}/${n}`;
    let image = baked.get(key);
    if (!image) {
      image = bake(subject, bakedDpr, f, n);
      baked.set(key, image);
    }
    return { image, size: bakedPixels(subject.size, bakedDpr) / bakedDpr };
  };

  return {
    source(dpr) {
      if (!Number.isFinite(dpr) || dpr <= 0) {
        throw new Error(`device pixel ratio must be a positive number, got ${dpr}`);
      }
      if (dpr !== bakedDpr) {
        baked = new Map();
        bakedDpr = dpr;
      }
      return source;
    },
  };
}

// A facing derived from a movement angle and a walk frame counted off a clock are both allowed to
// run past the end of the sheet; wrapping them here keeps a bad index from crashing the loop.
function wrap(index: number, length: number): number {
  return (((index % length) + length) % length) | 0;
}
