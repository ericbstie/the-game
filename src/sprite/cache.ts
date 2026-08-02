import type { SpriteName } from "./registry";
import { bakedPixels, bakeOne, type SpriteSubject } from "./sheet";

// The draw-time side of the sprite pipeline: baked offscreen canvases the render loop blits
// instead of drawing shapes.
//
// The one rule that shapes all of it comes from #77 §5. `GameScreen` paints through a scaled
// transform, so a sprite baked at its logical size is *upscaled* on a HiDPI display and reads as a
// smudge — at 28 px, 70% of a contour comes out grey. Sprites are therefore baked at the scale they
// are drawn at and blitted into a box exactly that many device pixels wide, which is one device
// pixel per baked pixel and so nothing to resample (see `BakedSprite.size`, which is what carries
// that box and is not always the nominal one).
//
// **That scale is `dpr × zoom`, not `dpr`** (ADR 0008). #77 §5 wrote the rule when the two were the
// same number; #92's camera zoom separated them, and the ADR measured the alternatives — baking at
// the top of the range, baking at reference scales, accepting soft ink — and found that only a bake
// at the size it is drawn at is right, at every zoom, by construction rather than by tuning. It is
// also the cheapest: a 1:1 blit is 3.9 µs against 7–8 µs resampled, and residency is a quarter of
// today's at 0.5× where baking at the top pays nine times it always.
//
// That scale is therefore a bake's identity: when it moves — a window dragged to a display of a
// different density, or a player turning the wheel — every bake in hand is the wrong resolution.
// What stops a zoom gesture paying that bill on every frame is not here: the caller holds the
// settled scale and asks for the new one once the hand stops (`zoom.ts`).
//
// **What stops the settled frame paying it whole is here.** Re-baking the set is 92–315 ms
// (`docs/frame-budget.md`), and it would be spent inside the one `requestAnimationFrame` callback
// that also steps the avatar and judges contact damage, on the thread that takes socket delivery —
// so paid whole it is a third of a second in which a surrounded player cannot move, cannot fire, and
// then takes every enemy's gated hit at once on resume. Instead each frame re-bakes what a fixed
// budget allows and **hands back the bake it already has for everything else**, resampled, so the
// picture sharpens over the frames after a settle rather than stopping on it.
//
// Only the newest bake of a variant is kept — the new one replaces the old one in the same entry —
// so a gesture that sweeps 0.5× to 3× holds one image per sprite at the end of it and never one per
// scale it crossed.
//
// Baking is lazy, per sprite. Nothing is baked until something asks to draw it, so a match that
// never spawns an elite never pays for one, and the fifteen sprite modules can land one at a time
// without the first frame growing to meet them. **A first bake is not deferrable**: there is no
// older bake to hand back in its place, and a hole in the picture is worse than a frame that runs
// long, so the budget governs re-baking and leaves the lazy path exactly as it was.

// What the render loop needs to put a sprite on screen: the baked image, and the box in world units
// to blit it into. World units, because `drawWorld` paints in them and the zoom that turns one into
// CSS pixels is the transform's business, not this box's — a 28-unit player is 28 units wide at
// every scale, and what changes with the zoom is how many device pixels the bake behind it holds.
//
// `size` is **not** always the subject's nominal box. It is `bakedPixels(size, scale) / scale` —
// the world width that comes out to exactly the bake's device-pixel width, so the blit is 1:1 and
// there is nothing to resample. Those agree whenever `size × scale` is a whole number, which is
// every character at every ratio drawn 1:1, but not a 15 px ore tile at 1.25× or 1.5× (Windows
// display scaling) and not one at any of the zooms in between #92's stops,
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
  // The sprites as they should be drawn at this scale — device pixels per world unit, which is the
  // device pixel ratio times the camera's zoom. A scale that has not moved is free.
  //
  // **Called once a frame, and that is what a frame is here**: this call opens the frame's bake
  // budget. A caller that asks twice gets two budgets, and one that never asks again keeps drawing
  // whatever it has.
  source(scale: number): SpriteSource;
}

type Bake = (
  subject: SpriteSubject,
  scale: number,
  facing: number,
  frame: number,
) => CanvasImageSource;

type Derive = (ink: CanvasImageSource, pixels: number, rim: number) => CanvasImageSource;

// How much ink the hit flash leaves standing around a spider's silhouette, in world units — so the
// outline is the same weight on a retina display as on a laptop, exactly as `SHOT_WIDTH` and the
// health bar are, and the same weight against the spider at every zoom.
//
// **One px is a ceiling, not a taste.** A rim is ink laid along the whole perimeter, and a grunt is
// almost entirely leg at 1.3–1.7 px wide, so past about a px the ink a rim adds outruns the ink the
// inversion takes away and a hit grunt comes out *darker*. Measured over every facing and frame of
// both spiders, identically at dpr 1, 2 and 3: at one px the grunt's ink coverage falls 0.126 → 0.090
// and the elite's 0.243 → 0.069, while at 1.5 px the grunt rises to 0.135 and at 2 px to 0.170.
const HIT_FLASH_RIM = 1;

const flashRim = (scale: number): number => Math.max(1, Math.round(HIT_FLASH_RIM * scale));

// How much of one frame may go into re-baking, in milliseconds.
//
// **Derived from the frame's own headroom rather than picked.** The worst frame is 6.3 ms of a
// 16.67 ms one and leaves 10.4 ms spare (`docs/frame-budget.md`). The zoom whose burst is dearest is
// the widest one, and that frame is 1.35–1.51× the headline — about 8.5–9.5 ms, leaving about 7–8.
// Four is under half of what is spare exactly where the burst is worst; the end with no headroom of
// its own (3×, twice the headline) is the end whose burst is the *cheapest*, 132 bakes against 545.
//
// **It bounds what a frame decides to spend, not what it spends.** A bake cannot be interrupted, so
// the check happens before one and never inside it, and a frame runs over by whatever it started —
// which grows with the scale, a 96 u nest at 3× dpr 2 being a 576 px canvas. Measured, that puts the
// dearest frame of a settle at 33 / 42 / 58 ms against a burst of 315 / 247 / 92 ms paid whole, and
// convergence at 13–51 frames.
//
// What it trades is how long held ink stands after a settle — about a second — and only a played
// match can judge that, so the figure is provisional and a later change to it is a retune. What is
// not provisional is that there is a budget at all.
export const BAKE_BUDGET_MS = 4;

// Injected the way `bake` and `derive` are, and for the same reason: a budget in milliseconds cannot
// be exercised under `bun test`, where a stubbed bake costs no time at all. A stub that advances its
// own clock can be.
export interface BakeBudget {
  budgetMs?: number;
  now?: () => number;
}

// A bake and the scale it was made for. The scale is what makes an entry stale rather than absent,
// which is the whole difference between a picture that sharpens and one that stops.
interface Held {
  image: CanvasImageSource;
  scale: number;
}

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
  { budgetMs = BAKE_BUDGET_MS, now = () => performance.now() }: BakeBudget = {},
): SpriteCache {
  const baked = new Map<string, Held>();
  let bakedScale = 0;
  let spent = 0;

  // The bake for `key` at the scale it is wanted at, made now unless this frame's budget is gone and
  // there is an older one to hand back instead.
  const held = (key: string, wanted: number, make: () => CanvasImageSource): Held => {
    const inHand = baked.get(key);
    if (inHand && (inHand.scale === wanted || spent >= budgetMs)) return inHand;
    const started = now();
    const fresh = { image: make(), scale: wanted };
    spent += now() - started;
    baked.set(key, fresh);
    return fresh;
  };

  const source: SpriteSource = (name, facing, frame, variant = "ink") => {
    const subject = subjects[name];
    if (!subject) return null;
    const f = wrap(facing, subject.facings);
    const n = wrap(frame, subject.frames);
    const key = `${name}/${f}/${n}`;
    const ink = held(key, bakedScale, () => bake(subject, bakedScale, f, n));
    if (variant === "ink") {
      return { image: ink.image, size: bakedPixels(subject.size, bakedScale) / bakedScale };
    }
    // Lazy per variant here too, and that is what makes the flash affordable: only the facings a
    // spider is actually hit in are ever derived, and a wave that never lands a hit on a
    // north-facing elite never pays for one.
    //
    // Derived at **the ink's** scale rather than at the frame's, because it is derived from that ink
    // and can be no fresher than it. Keyed at the frame's, an ink held over a settle would produce a
    // flash that looks current and no later frame would ever correct.
    //
    // The rim is floored at a whole device pixel: a rim of a fraction of one comes out grey rather
    // than thin, which is the same trap `bakedPixels` exists to keep a bake out of at Windows' 1.25×
    // scaling.
    const flash = held(`${key}/flash`, ink.scale, () =>
      derive(ink.image, bakedPixels(subject.size, ink.scale), flashRim(ink.scale)),
    );
    // Off the scale the flash in hand was made at, not off the ink's or the frame's: the box has to
    // be the world width of the art it holds, and the ink can be a generation ahead of it.
    const pixels = bakedPixels(subject.size, flash.scale);
    return { image: flash.image, size: (pixels + 2 * flashRim(flash.scale)) / flash.scale };
  };

  return {
    source(scale) {
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`bake scale must be a positive number, got ${scale}`);
      }
      bakedScale = scale;
      spent = 0;
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
