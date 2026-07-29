# `gun` — review notes

Sheet: [`gun.sheet.png`](gun.sheet.png), rendered at dpr 2. A dpr 1 sheet was rendered and read at
each round and not committed — only one sheet per sprite is kept
([`docs/sprite-loop.md`](../../docs/sprite-loop.md) §2).

**Process deviation, and how it was settled.** ADR 0002 §2 requires the producing agent to spawn a
*separate* subagent to look at the sheet. The session that produced rounds 1–3 had no agent-spawning
tool, so those reviews were done by the producing agent reading its own sheets — the loop's
"somebody looks at it" step happened, but not its independence. **Round 4 is that independent
review**, and it found two things three self-reviews had not. The debt is paid, and it was not
cosmetic.

Since round 4 the sprite's box equals the px the HUD blits it at, so the sheet above now shows what
a player sees. For rounds 1–3 it did not — see the last section.

## What it is

A pistol in side elevation, muzzle right, in two states: **facing 0 stowed and hollow**, **facing 1
equipped and filled**. One contour, drawn once. The equipped bake fills it and strokes it, the stowed
bake only strokes it — so the outer ink edge is `path + CONTOUR / 2` in both, and the icon neither
grows nor shifts when the gun comes up.

## Round 1 — rejected, it was a boot

The first bake put a long grip wedge down the left half of the box and only 5 units of barrel to the
right of it. Read cold it is a **boot**, or a sock: a wide sole tapering back, a short toe. Two
things caused it and both were fixed rather than tuned:

- **the barrel was not a barrel.** It ran x 21→26 against a 10-wide grip. A gun's proportions are
  mostly barrel; anything else is a tool.
- **the grip was a wedge, not a leg.** It ran from x 2.5 to 13 at the top. A grip has to be a limb
  hanging off the frame, narrow enough that the frame reads as the body.

Round 2 gave the barrel 12 units, cut the grip to 4 wide at the heel, and added a **hammer spur**
standing off the back. The spur is what settles it: a bar with a leg is a boot, an axe or a set
square, and nothing but a gun has a spur cocked back over its own grip. It is one of only four
features in the drawing and it earns its place.

## Round 2 — the trigger guard was built and dropped

The guard was built as a closed loop first, because a closed guard is the single most identifying
mark on a gun silhouette, and it was dropped. **The arithmetic written down for dropping it did not
survive being checked — round 4 below re-measured it and withdrew it.**

What the drawing does is unchanged and stands on its own: the guard is **solid**, and the finger
space is the **open notch** behind it, between the guard's rear wall and the grip's front strap —
3 units of paper joined to the outside, which no stroke can close. `ammo` reached the same shape of
answer, open negative space over enclosed white, and this is the second sprite in the set to land
there.

## Round 3 — the contour was thinned, and it made the ink *harder*

The obvious reading is that a stowed icon wants a heavy outline. Measured, the opposite:

| contour | stations | dpr 2 stowed | dpr 1 stowed | dpr 1, both bakes |
| --- | --- | --- | --- | --- |
| 1.4 | whole + half units | ink 406 · grey 402 (**50%** hard) | ink 65 · grey 207 (**24%**) | 51% of covered |
| **1.0** | **half units only** | ink 360 · grey 111 (**76%**) | ink 47 · grey 99 (**32%**) | **63% of covered** |

Nothing about the rasteriser changed. At 1.4 the ink edge of every long run — path ± 0.7 — landed
mid-pixel, so both sides of every line were anti-aliased twice over. At 1.0 with every axis-aligned
station on a half unit, the ink edge lands on a whole unit and the barrel's top and underside, the
frame's top, the guard's bottom and the heel carry **no anti-aliasing at all** at either density.
A crisp thin outline beats a soft thick one at this size, and this is the same finding
[`ammo.ts`](ammo.ts) records for its case walls.

The equipped bake improved with it: 1233 ink against 59 grey at dpr 2, **95% hard**.

Every number in this round was measured in the sprite's own 28-unit box, which round 4 found is not
the box the HUD blits. They reproduce on the 26-unit box to within a few pixels (dpr 2 stowed
346 · 110, **76%**; dpr 1 stowed 44 · 99, **31%**), so the finding survives intact — but the
measurement it was taken from did not describe what a player saw.

## Round 4 — the box did not match the blit, and the guard's arithmetic did not reproduce

An independent review of the shipped sprite raised two things. Both were re-measured here rather
than taken on report.

### The box was 28 and the HUD blits 26

`SpriteIcon` composes `scale = pixels / subject.size` **before** the dpr scale
([`SpriteIcon.tsx:39`](SpriteIcon.tsx)), so a 28-unit box shown at `GUN_ICON_PX = 26` is rescaled by
26/28 ≈ 0.929 on the way to the screen. Every station round 3 tuned onto a half unit landed
mid-pixel again, and the whole of round 3 was undone in the one place it mattered.

Measured at 26 CSS px — what the HUD actually draws — before and after `SIZE` went to 26:

| dpr | state | before: ink · grey | before hard | after: ink · grey | after hard |
| --- | --- | --- | --- | --- | --- |
| 1 | stowed | 0 · 192 | **0.0%** | 44 · 99 | **30.8%** |
| 1 | equipped | 187 · 143 | 56.7% | 240 · 80 | **75.0%** |
| 2 | stowed | 187 · 360 | 34.2% | 346 · 110 | **75.9%** |
| 2 | equipped | 1020 · 189 | 84.4% | 1160 · 58 | **95.2%** |
| 3 | stowed | 561 · 539 | 51.0% | 818 · 175 | **82.4%** |
| 3 | equipped | 2313 · 296 | 88.7% | 2632 · 92 | **96.6%** |

**The stowed bake at dpr 1 had zero hard ink.** Every covered pixel was grey. It is 100% edge by
construction — stroke only, nothing filled — so unlike `ammo` it had nothing to fall back on.

`SIZE = 26` fixes it: the composed scale becomes 1, 2, 3 at those densities and the half-unit
stations land where round 3 put them. It is not free — 26 units cannot hold a 25-unit-wide drawing
with a margin, so the silhouette lost **two units of width**, one off the frame's top and one off
the barrel. That split keeps the barrel's share of the drawing unchanged (11 of 23 units against
12 of 25) and leaves a unit of margin on all four sides, which the 28-unit version needed two of on
the left: the round join where the hammer's diagonal meets the backstrap throws a faint fringe one
pixel past the ink edge at dpr 1, and it has to land inside the box.

### `warning`'s crown loop is smaller than the guard's hole, not larger

Round 2 justified dropping the closed guard by saying a 9 × 9 guard block would carry ~10 css px² of
paper, "under `warning`'s crown loop", citing `ammo.review.md`'s figure of 13 css px². Flood-filled
from the border on real bakes, at the sizes the HUD blits:

| feature | dpr 1 | dpr 2 | dpr 3 | dpr 8 | geometric |
| --- | --- | --- | --- | --- | --- |
| `warning`'s crown loop, at its 24 px blit | 1.00 | 1.25 | 1.78 | 2.59 | **3.05 css px²** |
| the proposed guard's hole, at 26 px | 9.00 | 16.00 | 13.44 | 16.00 | **16 css px²** |

(`warning`'s hole is π × (1.9 − 1.5/2)² of a 28-unit box shown at 24 px. The guard is rebuilt from
round 2's own recipe on the shipped 8-unit guard block: the loop's wall path inset `CONTOUR / 2 +
CONTOUR` so the two strokes' ink edges clear each other by `CONTOUR`, leaving 4 × 4 of paper.)

So the comparison ran backwards. The guard's hole is **five times** `warning`'s, not under it, and
the 13 css px² it was measured against does not reproduce at any density. **The arithmetic is
withdrawn.** The guard stays out — it is not being re-added on the strength of a measurement taken
to correct a different claim — but the honest position is now that **whether a closed guard survives
dpr 1 is an open question**, not a settled one. Anyone reopening it should note the hole degrades
from 16 clear css px² at dpr 2 to 9 at dpr 1, which is the density-dependence round 3 of
[`ammo.review.md`](ammo.review.md) condemned, and that the shipped drawing has no width to spare.

## What is still wrong, and is shipping anyway

- **Two diagonals stay grey**, at both densities: the hammer's top edge and the grip's front strap.
  They are the only non-axis-aligned runs in the drawing and there is no fix that is not a
  straightening — a plumb front strap would cost the grip its rake, which is half of what says
  "held". Panel 3 at dpr 1 shows them as a two-tone stair. Accepted.
- **The stowed bake is light on a non-retina monitor** — 44 hard pixels against 99 grey. It reads,
  but it reads as a thin drawing rather than as ink. This is the resolution problem
  [`docs/sprite-loop.md`](../../docs/sprite-loop.md) says not to fight, and every fix for it was
  measured and rejected in #77. Accepted; worth a second look in the game.
- **The hammer spur is the weakest legible feature at real size.** At dpr 1 it is a 4 × 4 step off
  the frame's top-left. It is doing the work that stops the boot reading, so it stays, but if a
  later pass wants to spend units anywhere it should be here. Round 4 re-confirmed it; it is the
  known weak point of the drawing and it has not moved.
- **Gun is the only icon in the set whose visual weight is not constant across its states.** At its
  26 px blit and dpr 2 the stowed bake covers 456 pixels against the equipped bake's 1218 — and
  against `ammo`'s 1241 and `warning`'s 982, which have one state each. That is **intentional and it
  is the whole signal**: stowed reads as an outline of the gun and equipped as the gun, and a
  player is meant to see the difference across the room. Recorded because it is the one place this
  sprite deliberately breaks a property the rest of the HUD holds, and a later pass that "evens the
  icons up" would be deleting the feature.
- **No colour question arises** — the icon is pure ink on paper, as the direction requires.

## What was checked and is right

- Reads as a pistol at real size in **both** states (panel 2), which is the only panel that shows
  what a player sees.
- The two states are the **same silhouette**: covered box 46 × 48 device px at dpr 2, identical for
  facing 0 and facing 1. Toggling the gun changes ink, not geometry, so the icon does not twitch.
- No bake touches the edge of its box at dpr 1, 2 or 3 — checked at the HUD's blit size, not only
  in the sprite's own box.
- Bold contours, solid fill, **no interior detail** — nothing shaded, nothing hatched, no gradient.
- One frame; there is no animation to be inconsistent between.

## A hole in the loop itself, found by round 4

`bun run sprite:sheet` renders a sprite in **its own box**. When a sprite's `SIZE` differs from the
px the HUD blits it at, `SpriteIcon`'s composed `pixels / subject.size` scale never appears in the
sheet, so the sheet cannot show the anti-aliasing the player gets — and the numbers it prints
alongside describe a bake nobody ever sees. That is how a stowed bake with zero hard ink at dpr 1
passed three rounds of measurement.

**This is not specific to `gun`.** `ammo` has the same 28 → 26 mismatch. It survives it — 44% hard
at dpr 1 against gun's 0% — because it is a filled drawing with interior ink to fall back on, where
a stroke-only bake is 100% edge and loses everything. `warning` is 28 drawn at 24 and reads at 44%
for the same reason.

Nothing here is a fix to the harness; it is a note that the loop's standard step is blind to one
thing, and that a sprite whose box does not match its blit has to be measured separately. The probe
that produced round 4's numbers reproduces `SpriteIcon` exactly: canvas `round(px × dpr)`,
`ctx.scale(pixels / size, pixels / size)`, then `draw`.
