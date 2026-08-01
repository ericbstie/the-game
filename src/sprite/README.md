# The sprite contract

Everything one sprite agent needs. Fifteen of them run in parallel, none able to see the others'
work, so this is the whole agreement — follow it and your sprite drops into the game with nothing
else to negotiate.

The loop you work in (produce → sheet → reviewer → look) is
[`docs/sprite-loop.md`](../../docs/sprite-loop.md). The art direction is
[#76](https://github.com/ericbstie/the-game/issues/76) and the spec is
[#81](https://github.com/ericbstie/the-game/issues/81). This file is the seam between them and the
game.

## You write exactly one *module*

`src/sprite/<name>.ts`, default-exporting a `SpriteSubject`. It is the only **code** you write:
not `draw.ts`, not `registry.ts`, not `cache.ts` — wiring your sprite in is the integrator's job,
and it is two lines. Fifteen agents editing one file is fifteen conflicts; that is the whole
reason this rule exists.

You also commit two artefacts that are not code — your review sheet and your reviewer's notes —
so a finished sprite is three files:

```
src/sprite/grunt.ts          the module
src/sprite/grunt.sheet.png   what `sprite:sheet` rendered
src/sprite/grunt.review.md   what your reviewer said about it
```

## The shape

Declared in [`sheet.ts`](sheet.ts). Do not change it — the harness, the cache and `drawWorld` all
read it.

```ts
export interface SpriteSubject {
  name: string;
  size: number; // the logical box, in CSS px, which is also world units (the zoom is 1:1)
  facings: number;
  frames: number;
  draw(ctx: CanvasRenderingContext2D, size: number, facing: number, frame: number): void;
}
```

```ts
import type { SpriteSubject } from "./sheet";

const grunt: SpriteSubject = {
  name: "grunt", // the registry key, exactly — a test pins this
  size: 32,
  facings: 8,
  frames: 2,
  draw(ctx, size, facing, frame) {
    // ink, inside a size × size box
  },
};

export default grunt;
```

Three rules about `draw`:

- **It works in logical units.** The context is already scaled by `dpr` and the canvas is already
  `size × dpr`. Never multiply by `dpr` yourself, and never read `devicePixelRatio`.
- **The box is square and the same for every facing and frame.** One `size` covers your whole
  sprite, so it has to be the size of your *largest* facing or frame. Where the table below fixes
  a number, that number is the box and a test fails if you disagree with it — if your sprite
  genuinely cannot fit, raise it rather than widening `size`, because the game blits into that box
  and the entity's collision size is derived from the same constant.
- **The module must import cleanly under Bun.** No `document`, no canvas, no drawing at module
  scope — the runner imports your module without a DOM to compute the sheet's size. All of it
  happens inside `draw`.

## The two index axes

`SpriteSubject` gives you exactly two, and every sprite in the set uses them the same way:

| Axis | Means |
| --- | --- |
| `facing` | **The variant.** For a character, the 8 compass directions below. For everything else, whichever variants that sprite has — the egg sac's two states, the grass tufts, the room's four edges. |
| `frame` | **The animation.** Characters walk in 2. Everything static uses `frames: 1`, and the sheet then skips its flip panel. |

### The facing index — characters only

**This applies to `player`, `grunt` and `elite`, and to nothing else.** If your sprite has
`facings: 8` and a body that turns, these are your indices. If it is the egg sac, the ore, the
grass or the room, your facings are your own variants and the table below does not bind you — see
the per-sprite meanings in the set table.

For characters it is fixed and not yours to change. It is what [`calibration.ts`](calibration.ts)
already encodes: `angle = facing / 8 × 2π`, on a canvas whose y axis points **down**.

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E | SE | S | SW | W | NW | N | NE |

So facing 0 looks right, 2 looks **down the screen at the player**, 4 looks left, 6 looks away.

You may derive facings from fewer drawings — mirroring E to get W costs one `ctx.scale(-1, 1)`
and halves the work. Whether that reads as the same character from both sides is a judgement your
reviewer makes, not a rule here.

### The facing index — tiled sprites

**This applies to `ore-metal` and `ore-power`, and to anything else later drawn once per tile
across a field.** A tiled sprite has two requirements that pull in opposite directions, and one
number cannot satisfy both ([#87](https://github.com/ericbstie/the-game/issues/87)):

1. **Inside a patch, ink must cross tile seams.** Otherwise every mark is boxed in its own cell
   and a white lattice appears on the grid pitch — measured at an **8.08× centre-to-seam ink
   deficit** before this landed.
2. **At a patch boundary, ink must not reach the edge.** Otherwise the deposit ends in hard
   axis-aligned steps and the field reads as made of squares.

Your `draw` is handed `(size, facing, frame)` and nothing else, so on its own it cannot tell an
interior edge from a boundary one — it must pick one behaviour for all four and be wrong on one.

So the facing carries **both** facts, packed: which cell of a repeating 12×12 grid this tile is,
and which of its four neighbours hold the same thing. Do not unpack it by hand — call
[`drawTiled`](tiled.ts):

```ts
import { drawTiled, TILED_FACINGS } from "./tiled";

const oreMetal: SpriteSubject = {
  name: "ore-metal",
  size: 15,
  facings: TILED_FACINGS, // 16 masks × 12 × 12 cells
  frames: 1,
  draw(ctx, size, facing) {
    ctx.scale(size / 15, size / 15);
    drawTiled(ctx, 15, facing, paintCell);
  },
};
```

`drawTiled` calls your `paintCell(ctx, cx, cy)` **nine times** — for this cell and each of its
eight neighbours, translated into place — and clips everything to the tile's box. That is what
makes ink continuous across a seam: a mark near a cell boundary is generated identically by both
tiles, and each keeps its own half. On a boundary edge the clip pulls back and jags, so the patch
ends on an irregular line rather than on the tile grid.

Two rules follow, and both are measurable:

- **Derive your content from `cx` *and* `cy`.** Indexing on one alone stripes the field into
  identical rows. That shipped once and went unnoticed until it was measured at **37.5% of
  adjacent tile pairs drawing the identical stamp**.
- **Put marks on your east and south edges.** A field composed entirely inside its box contributes
  nothing to its neighbour, and the lattice survives every amount of machinery above it. East and
  south only — each seam belongs to exactly one of the two cells that share it, or you get two
  marks on every seam.

Check your work with `bun run ore:seams --kind metal --dpr 2`. It folds ink density modulo the
tile pitch over real accretion patches from `generateOre`, on a real canvas. A flat fold (≈1.00×)
means no lattice; a boundary edge far darker than an interior one means the patch still squares
off.

## The set, and the box each one draws in

The box is in CSS px, which is world units, because the zoom is 1:1 and does not change. Every
size below is **derived** from the size that thing already is in the simulation, so the art and
the collision it stands for cannot drift apart. They are in code as `SPRITE_BOX` in
[`registry.ts`](registry.ts), and a test fails if your `size` disagrees.

| `<name>` | Covers | Box | facings | frames | Drawn by the game? |
| --- | --- | --- | --- | --- | --- |
| `player` | the player sprite | **28** | 8 compass | 2 walk | yes |
| `grunt` | the long-legged spider | **32** | 8 compass | 2 walk | yes |
| `elite` | the big-bodied spider | **48** | 8 compass | 2 walk | yes |
| `nest` | the egg sac — **0 intact, 1 destroyed** | **96** | 2 | 1 | yes |
| `miner` | in elevation | **30** | 1 | 1 | yes |
| `wall` | the wall top, **from above** — masonry only on the faces a neighbour does not cover. The facing is a **4-bit neighbour mask**: 1 N, 2 E, 4 S, 8 W, so 0 stands alone and 15 is buried in a mass. `drawWorld` derives it | **30** | 16 | 1 | yes |
| `turret` | in elevation | **30** | 1 | 1 | yes |
| `generator` | **flat, from above** | **75** | 1 | 1 | yes |
| `ore-metal` | one tile, pure ink — several variants scattered across a patch | **15** | variants | 1 | yes |
| `ore-power` | one tile, glowing red — several variants | **15** | variants | 1 | yes |
| `room` | the perimeter wall unfolded outward: **0 N, 1 E, 2 S, 3 W**, and **4 the door** the run switches to where it crosses the exit | **30** | 5 | 1 | yes |
| `halo` | the self marker. Drawn **behind** your avatar and centred on its body, so make it wider than the player's 28 or it will not show | your call | 1 | your call | yes |
| `lettering` | in-world: the hand-lettered sound effect struck where a shot connects and where an enemy dies. The facing is **which word** — one variant per entry in that module's own `WORDS`, and `drawWorld` hands the cache an unwrapped index so the set's size never leaves the module | 36 | one per word | 1 | yes |
| `unpowered` | the hollow lightning over a turret holding a target it has no power to fire on | your call | 1 | **2+ — it flashes**, one frame per 400 ms | yes |
| `highlight` | the tutorial's ink mark (#134): **a ring or arrow in the era's style**, laid over the one thing the game is pointing at. It hangs off the **centre** of its box, like `halo` and `unpowered`. **One mark, two hosts** — `drawWorld` blits it over a 15 u ore tile in the world and `SpriteIcon` draws it into a 64 px box over the HUD's 56 px ammo button — so it has to read at both, and it must be a *ring round* a thing rather than a thing itself | your call | 1 | your call | yes — a plain stroked circle stands in until it lands |
| `grass` | the tufts scattered on the white floor | your call | variants | 1 | **not yet — see below** |
| `warning` | HUD: a structure is under attack | your call | 1 | 2+ (flashes) | **not yet — see below** |

"Your call" means #81 does not fix it and neither does this file. Choose, and say why in your
`review.md`.

### Two sprites the game does not draw yet

Be told this before you start, not after you finish. Thirteen of the fifteen are blitted by
`drawWorld` the moment their entry lands. Two are not, and neither is waiting on you:

- **`grass`** needs a **density** — how many tufts per tile of white floor — and that number is
  [#72](https://github.com/ericbstie/the-game/issues/72)'s to decide, because it is the same
  question as whether the frame holds with 240 enemies running over it. Nothing here will invent
  it. Draw the tufts; #72 wires them and chooses how thickly they fall.
- **`warning`** lives in the **HUD**, not the world, so `drawWorld` never sees it. It also needs a
  "something is under attack" state that no snapshot currently carries. It belongs with the UI
  agent's work.

Their modules still land in this directory and still go in the registry — the wiring test requires
it — they just have no call site yet. Your review sheet is the real feedback either way.


**Anchoring.** Overlays — `halo`, `unpowered` — hang off the **centre** of their box, because they
mark something rather than stand on the floor. Everything else is upright and stands on the
**bottom centre** of its box: the game puts that
point on the floor and the rest of the sprite reaches up from it. Draw with your sprite's feet at
the bottom edge. A building's box is exactly its footprint square, bottom edge on the front edge
of the footprint. The flat generator and the ore fill their box edge to edge.

**Colour is forbidden by default.** Black and white ink, everywhere, unless #76 granted an
exception — and it granted exactly two: the `halo` is barely yellow and mostly white, and
`ore-power` glows red. Metal ore stays pure ink, which is what tells the two ore kinds apart
without a legend.

## Render your sheet

```sh
bun run sprite:sheet src/sprite/grunt.ts            # → src/sprite/grunt.sheet.png
bun run sprite:sheet src/sprite/grunt.ts --dpr 1    # an ordinary, non-retina monitor
```

About a second. It writes the PNG **and** prints pixel facts measured on a real canvas — ink and
grey counts per bake, the box your ink actually covers, and a warning when a bake drew nothing or
ran into the edge of its box. Read them; they catch what the picture hides.

Then spawn your reviewer and record what it said. That is not optional and it is not this file's
subject — see [`docs/sprite-loop.md`](../../docs/sprite-loop.md).

## Sprites bake at `size × dpr`

The one rule behind everything else here, measured in
[#77 §5](https://github.com/ericbstie/the-game/issues/77#issuecomment-5080621289).

The render loop paints through `setTransform(dpr, …)`, so a sprite baked at its logical size is
**upscaled by that transform** before it reaches the screen: at 28 px it comes out visibly soft.
Sprites are therefore baked at `size × dpr` and blitted into a box **exactly that many device
pixels wide**, one device pixel per baked pixel, and the cache re-bakes the set when the display's
ratio changes.

That is deliberately not the same as "blitted into a `size`-CSS-px box". A canvas cannot be 22.5
pixels wide, so the bake is `round(size × dpr)`; where `size × dpr` is fractional — a 15 px ore
tile or a 75 px generator at Windows' **1.25× or 1.5×** scaling — the nominal box would land the
destination half a device pixel off its source, and every edge would resample. The cache hands the
corrected box to `drawWorld` instead, so a sprite can draw up to half a device pixel larger than
its nominal size. That is invisible, and it is the cheaper of the two errors.

The harness and the cache both do this for you. What it means for you is only this: **check your
sprite at `--dpr 1` as well as the default 2**, because that is a real monitor and it is where
your sprite has the fewest pixels to work with. **`--dpr 1.5` is worth a look too** if your box is
15, 30 or 75 — 1 and 2 are precisely the two ratios where the fractional case cannot show.

## Do not "fix" the anti-aliasing

At 28 px roughly **70% of a contour drawn the obvious way comes out grey**. That is not wrong ink.
It is not enough pixels. Every fix that suggests itself has already been measured and rejected
(#77 §4 and its addendum) — do not spend your hour rediscovering them:

- **Thresholding to hard black** gives literally zero grey pixels, and **shatters the curves**
  into a visible staircase while breaking thin strokes into dots. It passes a numeric check and
  looks wrong. The curves are the rubber-hose part; this trades them away.
- **`putImageData`, testing each pixel centre**, genuinely aliases — 2 grey levels against 80 —
  and goes **visibly polygonal**: at 28 px a circle becomes an octagon and small counters become
  square notches.
- **`getContext("2d", { antialias: false })`** is **silently ignored** (byte-identical output),
  and Chromium's canvas-AA flags are no-ops in this build — flags the harness would have and
  players would not.

Bake at `size × dpr` and leave the rasteriser alone. Two places where hard edges are correct and
free: `imageSmoothingEnabled = false` when *scaling an image* (which is genuinely controllable, and
is what the magnified review panel and the game's own blit both use), and **axis-aligned fills on
integer edges**, which carry no anti-aliasing at all — so walls, elevation faces and the build
ghost stay hard-edged for nothing.

## Never name the source

The player sprite is a simplified copy of a 1928 public-domain design. Its copyright expired;
**its trademark did not**. It is referred to as "the player sprite" and nothing else — not in the
code, not in a comment, not in your `review.md`, not in a commit message, not in the brief you
give your reviewer. #76 records what the design is; that is the only place it is written down.

## How your sprite reaches the game

You do not wire it in. When your file is merged, the integrator adds two lines to
[`registry.ts`](registry.ts):

```ts
import grunt from "./grunt";
// …
export const SPRITES: Partial<Record<SpriteName, SpriteSubject>> = { grunt };
```

Until then the game draws that entity as the coloured circle or rectangle it has drawn since M2,
and the suite stays green. That is deliberate: sprites land one at a time and nothing waits for
all of them.

The wiring is not optional, though, and it is not on the honour system: `registry.test.ts` globs
this directory and fails on any module without an entry. Without that check, a forgotten line is
indistinguishable from a sprite nobody has drawn yet — your work would merge green and never
appear.

To see yours in a real frame of the game, with no server and no lobby:

```sh
bun run sprite:frame                                  # the game as the registry has it
bun run sprite:frame --sprite grunt=src/sprite/grunt.ts   # layer a module over it
bun run sprite:frame --at 0,0                         # against the arena corner, for `room`
```
