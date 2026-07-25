import type { SpriteName } from "./registry";
import { bakeSubject, type SpriteSubject } from "./sheet";

// The draw-time side of the sprite pipeline: baked offscreen canvases the render loop blits
// instead of drawing shapes.
//
// The one rule that shapes all of it comes from #77 §5. `GameScreen` paints through
// `setTransform(dpr, …)`, so a sprite baked at its logical size is *upscaled* on a HiDPI display
// and reads as a smudge — at 28 px, 70% of a contour comes out grey. Sprites are therefore baked
// at `size × dpr` and blitted into a `size`-CSS-px box, which is one device pixel per baked pixel.
// That makes the device pixel ratio part of a bake's identity: when it changes, every bake in
// hand is the wrong resolution, so the cache empties itself rather than keeping a second copy of
// the whole sprite set for a display the player is no longer looking at.
//
// Baking is lazy, per sprite. Nothing is baked until something asks to draw it, so a match that
// never spawns an elite never pays for one, and the fifteen sprite modules can land one at a time
// without the first frame growing to meet them.

// What the render loop needs to put a sprite on screen: the baked image, and the logical box to
// blit it into. The image is `size × dpr` device pixels; `size` is CSS px, so the two disagree by
// design and the caller must use `size`.
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

type Bake = (subject: SpriteSubject, dpr: number) => CanvasImageSource[][];

// `bake` is injected so the bookkeeping can be tested under `bun test`, where happy-dom has no
// canvas at all and a real bake is impossible. It defaults to the harness's own `bakeSubject`,
// which is what already encodes the bake-at-`size × dpr` rule.
export function createSpriteCache(
  subjects: Partial<Record<SpriteName, SpriteSubject>>,
  bake: Bake = bakeSubject,
): SpriteCache {
  let baked = new Map<SpriteName, CanvasImageSource[][]>();
  let bakedDpr = 0;

  const source: SpriteSource = (name, facing, frame) => {
    const subject = subjects[name];
    if (!subject) return null;
    let frames = baked.get(name);
    if (!frames) {
      frames = bake(subject, bakedDpr);
      baked.set(name, frames);
    }
    return {
      image: frames[wrap(frame, subject.frames)][wrap(facing, subject.facings)],
      size: subject.size,
    };
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
