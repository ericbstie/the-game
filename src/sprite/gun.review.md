# `gun` — review notes

Sheet: [`gun.sheet.png`](gun.sheet.png), rendered at dpr 2. A dpr 1 sheet was rendered and read at
each round and not committed — only one sheet per sprite is kept
([`docs/sprite-loop.md`](../../docs/sprite-loop.md) §2).

**Process deviation, stated up front.** ADR 0002 §2 requires the producing agent to spawn a
*separate* subagent to look at the sheet. The session that produced this sprite had no
agent-spawning tool, so the review below was done by the producing agent reading the rendered sheets
directly — the loop's "somebody looks at it" step happened, but not its independence. The notes are
recorded here as the ADR requires so the author reviews the art already knowing what was flagged;
a second pair of eyes on this one is still owed.

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

## Round 2 — the trigger guard was measured and dropped

The guard was built as a closed loop first, because a closed guard is the single most identifying
mark on a gun silhouette, and it was abandoned on arithmetic rather than on taste:

- an enclosed hole loses `CONTOUR` off each of its sides;
- **and** its walls have to clear the outer contour by another `CONTOUR`, or in the hollow state the
  two strokes merge into one bar and the hole is gone;
- so a guard block 9 × 9 — which is already a third of the box — carries a hole of about
  **12 units², ~10 css px² at the 26 px this is drawn at**. That is *under* `warning`'s crown loop,
  which round 3 of [`ammo.review.md`](ammo.review.md) already condemned as a feature present on
  retina and gone off it. A hole that survives wants an 11-unit block, which is most of the height
  the frame and the grip need between them.

So the guard is drawn **solid**, and the finger space is the **open notch** behind it, between the
guard's rear wall and the grip's front strap: 3 units of paper joined to the outside, which no
stroke can close. `ammo` reached the same answer for the same reason — open negative space over
enclosed white — and this is the second sprite in the set to land there.

**Do not re-add the loop without re-measuring.** It has been built and dropped once.

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

## What is still wrong, and is shipping anyway

- **Two diagonals stay grey**, at both densities: the hammer's top edge and the grip's front strap.
  They are the only non-axis-aligned runs in the drawing and there is no fix that is not a
  straightening — a plumb front strap would cost the grip its rake, which is half of what says
  "held". Panel 3 at dpr 1 shows them as a two-tone stair. Accepted.
- **The stowed bake is light on a non-retina monitor** — 47 hard pixels against 99 grey. It reads,
  but it reads as a thin drawing rather than as ink. This is the resolution problem
  [`docs/sprite-loop.md`](../../docs/sprite-loop.md) says not to fight, and every fix for it was
  measured and rejected in #77. Accepted; worth a second look in the game.
- **The hammer spur is the least legible feature at real size.** At dpr 1 it is a 4 × 4 step off the
  frame's top-left. It is doing the work that stops the boot reading, so it stays, but if a later
  pass wants to spend units anywhere it should be here.
- **No colour question arises** — the icon is pure ink on paper, as the direction requires.

## What was checked and is right

- Reads as a pistol at real size in **both** states (panel 2), which is the only panel that shows
  what a player sees.
- The two states are the **same silhouette**: covered box 50 × 48 device px at dpr 2, identical for
  facing 0 and facing 1. Toggling the gun changes ink, not geometry, so the icon does not twitch.
- No bake touches the edge of its box at either density.
- Bold contours, solid fill, **no interior detail** — nothing shaded, nothing hatched, no gradient.
- One frame; there is no animation to be inconsistent between.
