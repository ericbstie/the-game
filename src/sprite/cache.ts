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
// box; that is the cheaper of the two errors, and it is invisible. The flash variant is wider again
// by its rim, which is why the box travels with the image rather than being derived from the name.
export interface BakedSprite {
  image: CanvasImageSource;
  size: number;
}

// Which bake of a sprite is wanted. `flash` is the one a spider wears for the 90 ms after it takes
// damage (#107): paper where its ink was, its own white marks back in ink, and a rim of ink standing
// around the silhouette — because the floor is white paper, and a solid white spider would be an
// invisible spider.
//
// It is **derived** from the ink bake rather than drawn, because a sprite module hardcodes the ink
// colour it draws with, so there is no white version of it to ask for.
export type SpriteVariant = "ink" | "flash";

// Looking up a sprite is the whole seam between produced art and `drawWorld`: one call, and null
// for anything not yet drawn. `drawWorld` takes one of these, so a test can hand it a stub and a
// screenshot harness can hand it a single sprite under review.
export type SpriteSource = (
  name: SpriteName,
  facing: number,
  frame: number,
  variant?: SpriteVariant,
) => BakedSprite | null;

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

type Derive = (ink: CanvasImageSource, pixels: number, rim: number) => CanvasImageSource;

// How much ink the hit flash leaves standing around a spider's silhouette, in logical px — so the
// outline is the same weight on a retina display as on a laptop, exactly as `SHOT_WIDTH` and the
// health bar are.
//
// **One px is a ceiling, not a taste.** A rim is ink laid along the whole perimeter, and a grunt is
// almost entirely leg at 1.3–1.7 px wide, so past about a px the ink a rim adds outruns the ink the
// inversion takes away and a hit grunt comes out *darker*. Measured over every facing and frame of
// both spiders, identically at dpr 1, 2 and 3: at one px the grunt's ink coverage falls 0.126 → 0.090
// and the elite's 0.243 → 0.069, while at 1.5 px the grunt rises to 0.135 and at 2 px to 0.170.
const HIT_FLASH_RIM = 1;

// `bake` and the flash `derive` are injected so the bookkeeping can be tested under `bun test`, where
// happy-dom has no canvas at all and a real bake is impossible. They default to the harness's own
// `bakeOne`, which is what already encodes the bake-at-`size × dpr` rule, and to `bakeHitFlash`.
//
// Baking is lazy per **variant**, not per sprite. That matters from #87 on: an ore tile's variant
// index is a product — its position cell times its neighbour-occupancy mask — so it declares
// thousands of combinations while any one frame asks for a few hundred. Baking a sprite's whole
// grid on first use would have made the first ore tile on screen cost every combination that could
// ever exist. This way the bill tracks what is actually drawn.
export function createSpriteCache(
  subjects: Partial<Record<SpriteName, SpriteSubject>>,
  bake: Bake = bakeOne,
  derive: Derive = bakeHitFlash,
): SpriteCache {
  let baked = new Map<string, CanvasImageSource>();
  let bakedDpr = 0;

  const held = (key: string, make: () => CanvasImageSource): CanvasImageSource => {
    let image = baked.get(key);
    if (!image) {
      image = make();
      baked.set(key, image);
    }
    return image;
  };

  const source: SpriteSource = (name, facing, frame, variant = "ink") => {
    const subject = subjects[name];
    if (!subject) return null;
    const f = wrap(facing, subject.facings);
    const n = wrap(frame, subject.frames);
    const pixels = bakedPixels(subject.size, bakedDpr);
    const ink = held(`${name}/${f}/${n}`, () => bake(subject, bakedDpr, f, n));
    if (variant === "ink") return { image: ink, size: pixels / bakedDpr };
    // Lazy per variant here too, and that is what makes the flash affordable: only the facings a
    // spider is actually hit in are ever derived, and a wave that never lands a hit on a
    // north-facing elite never pays for one.
    //
    // Floored at a whole device pixel: a rim of a fraction of one comes out grey rather than thin,
    // which is the same trap `bakedPixels` exists to keep a bake out of at Windows' 1.25× scaling.
    const rim = Math.max(1, Math.round(HIT_FLASH_RIM * bakedDpr));
    return {
      image: held(`${name}/${f}/${n}/flash`, () => derive(ink, pixels, rim)),
      size: (pixels + 2 * rim) / bakedDpr,
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

// Matching what every sprite module draws with, so a derived variant is the same ink as the bake it
// came from.
const INK = "#000000";

// The hit flash's variant, derived from the ink bake in hand: a `rim`-device-px shell of ink around
// the silhouette, with the bake inverted inside it.
//
// Derived rather than composited per frame because the per-frame version cost **~70 µs a flashing
// spider** — nine blits and two mode switches — which made it the dearest thing in the frame per
// unit, ahead of a shot line (`docs/frame-budget.md` rule 6). This is one blit at the draw site
// instead, ~310 µs once per pose, and the morphology stops being something a frame has to afford: it
// is computed here, once, so it can be as careful as it needs to be.
//
// Opaque paper inside and transparent outside, so it stands on its own. The per-frame version filled
// paper *behind* the whole box and so depended on nothing else in that box being transparent, which
// held only because `drawWorld` opens with an opaque paper fill over the viewport.
function bakeHitFlash(ink: CanvasImageSource, pixels: number, rim: number): CanvasImageSource {
  const canvas = document.createElement("canvas");
  canvas.width = pixels + 2 * rim;
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context: sprites can only be baked in a real browser");
  // A disc of offsets rather than a cross of four: a cross grows a leg running diagonally by 0.7 px
  // where it grows an upright one by a whole px, and eight legs is mostly diagonals.
  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      if (dx * dx + dy * dy <= rim * rim) ctx.drawImage(ink, rim + dx, rim + dy, pixels, pixels);
    }
  }
  // Flattened to one flat ink, because a spider's eye sits under a px inside its own contour: a copy
  // of the bake offset by the rim carries that white out into the rim and nicks the outline.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  // Inverted rather than flooded white, so the face survives the flash and a hit spider still reads
  // as the creature that was standing there a frame ago rather than as a stencil of it.
  ctx.filter = "invert(1)";
  ctx.drawImage(ink, rim, rim, pixels, pixels);
  ctx.filter = "none";
  return canvas;
}

// A facing derived from a movement angle and a walk frame counted off a clock are both allowed to
// run past the end of the sheet; wrapping them here keeps a bad index from crashing the loop.
function wrap(index: number, length: number): number {
  return (((index % length) + length) % length) | 0;
}
