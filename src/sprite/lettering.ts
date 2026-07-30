import type { SpriteSubject } from "./sheet";

// The lettered sound effect that pops where a shot connects and where an enemy dies (#79): a
// hand-lettered word with a starburst thrown off it, one variant per word.
//
// **It is a drawing of a word, not a word.** Every letter here is a stroked path — no `fillText`,
// no typeface, nothing the browser has to have a font for. That is the whole reason ADR 0001's
// grant for this could be written without reopening the rest of the ADR: the arena gains four
// drawings, and it gains no second place where the game writes prose. `lettering.test.ts` holds it.
//
// **The letters are ink and every one of them carries its own paper**, which is not a colour choice
// but the only arrangement that reads. The floor is white paper (#72) and the set is solid ink, so a
// black word laid over a spider is a black word on black; and #107 has that spider inverted to
// *paper* for exactly the window this mark is up, so a white word laid over it would be white on
// white. Ink cut out of paper survives both. It is the same treatment a player's name and a miner's
// `+1` already get, and for the same reason — the field is carried per letter rather than as a plate
// behind the word, which is what keeps it off the spider the word belongs to.
//
// **Every mark is baked, so detail inside the box is free** (`docs/frame-budget.md` rule 6). What a
// word costs the frame is one blit, whatever is drawn in it — which is why every spike is jittered
// and the letters lean and bounce off the baseline rather than being struck from one stamp. Hand
// lettering that is regular is type.

// The words. **Provisional**, and a look choice rather than a derivation: #79 asks for "a small
// fixed set" and names POW and ZAP in its own title, and the other two are chosen to sit beside
// them. Four is small enough that the set reads as a vocabulary rather than as a random generator,
// and it is deliberately not tuned to how often a word repeats on screen — that is a number only a
// played match can judge, and changing it is a retune.
//
// **All four are three letters, and that is the constraint the box sets rather than a taste.** A
// word is struck centred on the blow in a box that must clear a damaged spider's health bar (see
// `SIZE`), so the width the letters have is fixed; a fourth letter takes each one from 7.2 units
// wide to 5.3, and at dpr 1 that is five device pixels to carry a W. The set is chosen so no word
// needs the room a fourth letter would take, and so the seven letterforms below cover all of it.
export const WORDS = ["POW", "ZAP", "BAM", "BOP"] as const;

// The box, and the one number here that is derived rather than chosen.
//
// A word is blitted centred on the mark, so it reaches `SIZE / 2` above the point it belongs to. A
// damaged spider carries the game's only damage readout directly above its sprite (#81) — for a
// grunt, `BAR_GAP` 3 + `BAR_HEIGHT` 4 above a 32-unit box, so the bar's underside sits **19** above
// the mark. At 36 the box stops a unit short of it. #115 had the same problem and put its long
// spikes on the diagonal, where a spike is clear of the bar's width before it is above the bar; a
// blitted box has no diagonal to hide in, so the box itself is what has to clear it.
//
// It is also just inside `PUFF_REACH` (19), which is what leaves #116's scalloped cloud reading
// around a lettered death rather than being swallowed by it — the puff's outline runs at 14 to 19,
// where the lettering's own paper stops at 16.6 across and 9.4 up.
//
// 36 × dpr is a whole number at 1, 2, 3 and at Windows' 1.25 and 1.5, so the blit is 1:1 at every
// ratio a player is likely to have and `BakedSprite.size` never has to correct the box (#77 §5).
const SIZE = 36;
const CENTRE = SIZE / 2;

// Every word in the set is the same length, so the lettering's own extent is one figure rather than
// four — which is what lets the spikes below be laid out against it once. Pinned by a test, because a
// longer word would silently letter itself out under the spikes rather than failing.
const WORD_LETTERS = WORDS[0].length;

// The starburst, as spikes struck *around* the word rather than as a star drawn under it — and this
// is the one thing here that was arrived at by measuring rather than by drawing.
//
// A field big enough to hold three legible letters is 33 units across, which in a 36 box leaves a
// star nothing to be. Four bakes of one were rendered before this treatment, and each failed:
// a 12-point star **under** the word had its east and west points cut off their own body by the
// word's paper and left a black tick floating beside it; rotating the star half a step moved the
// damage to four points instead of two; drawing the star **over** the word put its points through
// the letters, and `POW` read `POИ`; dropping the word's paper altogether merged the outer letters
// into the star's ink, which is the same failure without the separation that made it visible. The
// arithmetic behind all four is that the word's paper reaches 16.6 units at the height it is
// lettered on and any star that fits the box has its valleys at 9 — so the paper always crosses the
// outline, whatever order they are struck in.
//
// So the spikes start **outside** the word's own paper and run out to the edge of the box. Where
// there is no room for one — along the horizontal, where the word itself reaches almost to the box —
// none is struck. That leaves the mark bursting above and below the lettering, which is what a
// shouted word in a cartoon does anyway, and nothing can be severed because nothing is drawn across
// anything.
const SPIKES = 16;
// How much of its reach a short spike gives up, and the paper left between a spike's inner end and
// the lettering. Alternating long and short is #115's device and it is here for the same reason: a
// ring of equal spikes reads as a wheel.
const SPIKE_SHORT = 0.62;
const SPIKE_GAP = 0.8;
// Under this a spike is a dot rather than a ray, so the bearing goes without one.
const SPIKE_MIN = 1.8;

// How heavy a spike is. **Stroked at an even width, and tapered spikes were built and dropped to get
// here.** A star's point reads as a point because it stands on a body, and this mark has no body to
// spare — the lettering is the body. Filled triangles standing free came out as four detached wedges
// per corner, which read as debris rather than as a burst. An even ray is the honest drawing of what
// this is: ink thrown outward off a word.
//
// The weight is a look and provisional, and it sits just under `SHOT_WIDTH`'s 2 on purpose: the
// lettering is the heavy thing here, and rays as heavy as the pen the rest of the game strikes with
// competed with it rather than radiating off it.
const SPIKE_WIDTH = 1.7;

// How far a spike's point may reach, **derived from the width rather than picked**. `lineCap` is
// round, so a stroke runs half its width past the point it was told to end at; at 1.7 that is what
// took the first bake of this treatment 0.25 units outside its own box, and the sheet reported two
// bakes touching the edge. This is the furthest a spike can end and still have its cap land inside.
const SPIKE_REACH = CENTRE - SPIKE_WIDTH / 2;
// How much of its reach a spike may give up to the hand, as a fraction. **One-sided, and that is
// arithmetic rather than style**: `SPIKE_REACH` plus half the spike's width is exactly the box, so a
// wobble allowed to run the other way would put the longest spike outside it and the bake would crop
// every tip it produced.
const WOBBLE = 0.1;

// One letter's design box, and the step from one letter to the next. The step is under the box's
// width plus the ink, so neighbouring letters very nearly touch: crowded lettering is what a
// cartoon shout looks like, and space between letters is what a caption looks like.
const LETTER_W = 7.2;
const LETTER_H = 11.4;
const LETTER_PITCH = 9.7;

// The weight of the lettering, and the paper it carries with it.
//
// The paper is not decoration and it is not a shadow: it is the field the ticket asks the letters to
// sit on, carried by each letter instead of by a plate behind them. The floor is white, but a word
// struck over a spider is ink on ink, so stroked in paper first and in ink second every letter
// brings its own ground with it — which is exactly how `drawFloats` keeps a miner's `+1` legible and
// how a player's name is cut out over a teammate.
const STROKE = 2.4;
const HALO = 1.3;

// How far the hand is allowed to wander, per letter: the lean off upright in radians, the bounce off
// the baseline in units, and the size either side of nominal as a fraction. Small on purpose — this
// is a hand that letters quickly, not a drunk one — and every value is derived from the letter's
// own index, so a word is the same drawing every time it is baked.
const LETTER_LEAN = 0.09;
const LETTER_BOUNCE = 0.6;
const LETTER_GROW = 0.04;

const INK = "#000";
const PAPER = "#fff";

// A letterform, in a 0…1 box: a run of strokes, each either struck corner to corner or smoothed
// through its points. Nothing is filled — a letter is a pen stroke of `STROKE` units, which is what
// gives every one of them the same weight without a single outline being drawn twice.
//
// `smooth` is the rubber-hose axis. A bowl is a curve and has to be one; a W is corners, and
// smoothing them turns it into a wave. The two cases are marked rather than inferred. `closed` is the
// `O`'s alone — a letterform that comes back to where it started, which needs the curve carried
// through the joint rather than stopped at it.
interface Stroke {
  points: readonly (readonly [number, number])[];
  smooth?: true;
  closed?: true; // only meaningful with `smooth`; no straight-sided letter in the set closes
}

// Seven letterforms cover all four words: POW, ZAP, BAM and BOP share every letter between them,
// which is the other half of why the set is the set. Each is asymmetric somewhere — a stem that
// leans, a bar that is not level, a bowl that is fuller at the bottom — because a letter drawn
// symmetrically at this size reads as type however heavy it is.
const GLYPHS: Record<string, readonly Stroke[]> = {
  P: [
    {
      points: [
        [0.1, 0],
        [0, 1],
      ],
    },
    {
      points: [
        [0.07, 0.03],
        [0.62, 0.05],
        [0.9, 0.25],
        [0.6, 0.46],
        [0.03, 0.47],
      ],
      smooth: true,
    },
  ],
  O: [
    {
      points: [
        [0.5, 0],
        [0.95, 0.2],
        [0.97, 0.8],
        [0.5, 1],
        [0.04, 0.79],
        [0.03, 0.2],
      ],
      smooth: true,
      closed: true,
    },
  ],
  W: [
    {
      points: [
        [0, 0.02],
        [0.25, 1],
        [0.5, 0.46],
        [0.75, 1],
        [1, 0],
      ],
    },
  ],
  Z: [
    {
      points: [
        [0.04, 0.05],
        [0.96, 0],
        [0.06, 0.97],
        [0.98, 0.93],
      ],
    },
  ],
  A: [
    {
      points: [
        [0, 1],
        [0.52, 0],
        [1, 1],
      ],
    },
    {
      points: [
        [0.17, 0.66],
        [0.83, 0.62],
      ],
    },
  ],
  B: [
    {
      points: [
        [0.1, 0],
        [0.02, 1],
      ],
    },
    {
      points: [
        [0.08, 0.02],
        [0.58, 0.04],
        [0.8, 0.22],
        [0.56, 0.44],
        [0.05, 0.45],
      ],
      smooth: true,
    },
    {
      points: [
        [0.06, 0.45],
        [0.64, 0.47],
        [0.9, 0.72],
        [0.6, 0.98],
        [0.01, 0.97],
      ],
      smooth: true,
    },
  ],
  M: [
    {
      points: [
        [0, 1],
        [0.16, 0],
        [0.5, 0.62],
        [0.84, 0],
        [1, 1],
      ],
    },
  ],
};

// A number in [0, 1) from a pair of small integers, so every wandering value here is a property of
// the word and the mark it belongs to rather than of the run. The mix is `tileVariant`'s, which is
// what the grass scatter already derives its field from.
function wobble(word: number, index: number): number {
  const mixed = Math.imul(((word + 1) * 73_856_093) ^ ((index + 1) * 19_349_663), 0x45d9f3b);
  return (((mixed ^ (mixed >>> 15)) >>> 0) % 4096) / 4096;
}

// Centred on zero: a wobble spends its range either side of nominal, never all of it on one side.
const swing = (word: number, index: number, range: number) =>
  (wobble(word, index) - 0.5) * 2 * range;

// How far the word's paper reaches from the centre along one bearing. The lettering is a box — a run
// of letters on one line — so this is a ray against a rectangle and nothing more, and it is what
// every spike below starts from. Derived from the layout rather than measured off the glyphs, so a
// retune of the letter size or the halo moves the spikes with it instead of leaving them overlapping
// the word.
function lettered(bearing: number): number {
  const cos = Math.abs(Math.cos(bearing));
  const sin = Math.abs(Math.sin(bearing));
  // Ink plus paper, plus what the hand's lean, bounce and size can add to either half-extent.
  const pad = STROKE / 2 + HALO;
  const half = ((WORD_LETTERS - 1) * LETTER_PITCH + LETTER_W) / 2 + pad + LETTER_W * LETTER_LEAN;
  const rise = LETTER_H / 2 + pad + LETTER_BOUNCE + LETTER_H * LETTER_LEAN;
  return Math.min(cos === 0 ? Infinity : half / cos, sin === 0 ? Infinity : rise / sin);
}

// The spikes, each struck from just clear of the word out to the edge of the box, and skipped
// wherever the word already fills the bearing.
function spikes(ctx: CanvasRenderingContext2D, word: number): void {
  ctx.beginPath();
  for (let i = 0; i < SPIKES; i++) {
    const bearing = (i * 2 * Math.PI) / SPIKES;
    const from = lettered(bearing) + SPIKE_GAP;
    const full = SPIKE_REACH * (1 - WOBBLE * wobble(word, i));
    const to = i % 2 === 1 ? from + (full - from) * SPIKE_SHORT : full;
    if (to - from < SPIKE_MIN) continue;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    ctx.moveTo(CENTRE + dx * from, CENTRE + dy * from);
    ctx.lineTo(CENTRE + dx * to, CENTRE + dy * to);
  }
}

// One stroke of one letter, in the letter's own box, under whatever transform the caller has set.
//
// Smoothed through the midpoints between its points rather than through the points themselves,
// which is what turns a short list of hand-placed points into one continuous curve: each point
// becomes the control of a quadratic that ends halfway to the next one, so the pen never changes
// direction at a joint. It is the cheapest way to letter a bowl without authoring bezier controls
// for every glyph by hand, and at this size it is indistinguishable from having done so.
function strand(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number): void {
  const at = (i: number): [number, number] => {
    const p = stroke.points[i];
    return [p[0] * w, p[1] * h];
  };
  const mid = (i: number, j: number): [number, number] => {
    const a = at(i);
    const b = at(j);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const last = stroke.points.length - 1;
  if (!stroke.smooth) {
    ctx.moveTo(...at(0));
    for (let i = 1; i <= last; i++) ctx.lineTo(...at(i));
    return;
  }
  if (stroke.closed) {
    ctx.moveTo(...mid(last, 0));
    for (let i = 0; i <= last; i++) {
      const next = i === last ? 0 : i + 1;
      ctx.quadraticCurveTo(...at(i), ...mid(i, next));
    }
    ctx.closePath();
    return;
  }
  ctx.moveTo(...at(0));
  for (let i = 1; i < last; i++) ctx.quadraticCurveTo(...at(i), ...mid(i, i + 1));
  ctx.lineTo(...at(last));
}

// The whole word as one path, every letter placed on its own lean, bounce and size. Struck twice by
// the caller — paper under, ink over — from this one layout, so the halo can never be a pixel out
// of register with the letter it belongs to.
function word(ctx: CanvasRenderingContext2D, index: number): void {
  const letters = WORDS[index % WORDS.length];
  // Centred as a run rather than per letter, so the word sits on the blow and not the first letter.
  const left = CENTRE - ((letters.length - 1) * LETTER_PITCH + LETTER_W) / 2;
  ctx.beginPath();
  for (let i = 0; i < letters.length; i++) {
    ctx.save();
    ctx.translate(
      left + i * LETTER_PITCH + LETTER_W / 2,
      CENTRE + swing(index, i * 3 + 1, LETTER_BOUNCE),
    );
    ctx.rotate(swing(index, i * 3 + 2, LETTER_LEAN));
    const grow = 1 + swing(index, i * 3 + 3, LETTER_GROW);
    ctx.scale(grow, grow);
    ctx.translate(-LETTER_W / 2, -LETTER_H / 2);
    for (const stroke of GLYPHS[letters[i]]) strand(ctx, stroke, LETTER_W, LETTER_H);
    ctx.restore();
  }
}

const lettering: SpriteSubject = {
  name: "lettering",
  size: SIZE,
  facings: WORDS.length, // the variant axis is which word (`src/sprite/README.md`)
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / SIZE, size / SIZE);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // The spikes first, so the word's paper trims their inner ends flush against the lettering
    // rather than leaving `SPIKE_GAP` to hold that line by itself.
    spikes(ctx, facing);
    ctx.strokeStyle = INK;
    ctx.lineWidth = SPIKE_WIDTH;
    ctx.stroke();

    // Then the word, laid out once and struck twice: the whole word's paper before any of its ink,
    // never letter by letter. Per letter, the halo of the one after it would eat into the ink of the
    // one before — they are `LETTER_PITCH` apart and the halo is wider than the gap.
    word(ctx, facing);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = STROKE + 2 * HALO;
    ctx.stroke();
    word(ctx, facing);
    ctx.strokeStyle = INK;
    ctx.lineWidth = STROKE;
    ctx.stroke();
  },
};

export default lettering;
