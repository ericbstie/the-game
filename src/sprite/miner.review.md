# miner — review

Box **30** (the 2×2 footprint at `TILE` 15), `facings: 1`, `frames: 1`. A building has no
directions and no animation, so both index axes are spent: one bake, one variant.

Reviewed per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)
by subagents that read `miner.sheet.png` and looked at it, alongside `wall.sheet.png` and
`turret.sheet.png` — the other two buildings that share this footprint. Readability judged on
panel 2, artefacts on panel 3. Findings are advisory; what was done about each is recorded below.

Also checked at `--dpr 1`, the density with the fewest pixels to work with. The wheel's bore, the
gap between the legs, the deck edge and the ore mouth all survive it; the mouth loses its arch and
reads as a plain notch.

## One number on the sheet reads backwards

`sprite:sheet` counts a **white** pixel as *grey* — "covered but not ink". This sprite is drawn on
its own paper, so roughly half of what it reports as grey is deliberate white, not anti-aliasing.
Read the picture, not the ratio.

---

## Round 1 — two reviewers, run independently

Both were given the sheet and the two sibling sheets, and both landed in the same place without
seeing each other.

**What it was.** A white box with an ink contour, a stack and a hopper breaking the roofline, a
wheel and a small block on the front face.

**What they said it looked like.** A front-loading washing machine; an old box camera; a cash
register; a stove. Neither reviewer got to "machine that mines" unprompted.

| Finding | Both? | Done |
| --- | --- | --- |
| Bottom-right block welded to the floor bar and 1 px off the right wall — a lump, not a detail | yes | **deleted** |
| The top-left stack reads as a hammer / flag / desk lamp, and butt-welds into the roof | yes | **deleted** |
| Two weak roof events beat by one strong one | yes | rebuilt around a single event |
| Solid-black roof furniture vanishes on ore, and it was the only thing separating miner from wall | yes | every ink mass now carries a **1 px white keyline** |
| The wheel is the best thing in it — nothing else in the set is an annulus | one | kept, and made the identity |
| The wheel is *also* what makes it read as an appliance: a big circle in a box is a porthole | the other | resolved by moving it out of the box and onto a headframe |
| Uniform stroke weight reads as CAD, not ink | yes | weights now differ: keyline 1, brace 2, rim 3, legs 3–4 |
| Mixed corner language — radiused lip over a square body | one | one radius, on the housing only |
| Sub-pixel edges going grey; the ring's hole filling in | yes | geometry back on integers, bore enlarged |

The disagreement about the wheel was the useful part. It is worth keeping *and* it was causing the
appliance read — which means the problem was never the wheel, it was the box around it.

## Round 2

**What it was.** A wheel with three spokes and a stack standing on a housing, with an arched door.

**What it said it looked like.** A stove. "You have traded washing machine for stove."

Three findings that mattered, all structural:

1. **"Your miner is a one-pane window."** The wall is a black frame around six white panes; this was
   a black frame around one. Same family. On ore the black merges and *what survives is the white
   panel* — the one shape that is the wall's. The miner was degrading into the wall on the terrain
   it is required to stand on. This is the finding that forced the redesign.
2. **The wheel floated.** A gap between it and the housing, nothing carrying it: "a sticker on a
   lid". The top third read as flat symbol, the bottom two-thirds as elevation — two projections in
   one sprite.
3. **The spokes did not exist at 30 px.** Three thin wedges at 120° filled in solid at real size,
   and read as a badge when they did show. Measured on panel 2, not inferred.

Its own suggestion was the way out: *the A-frame silhouette carries "pithead" better than the wheel
does at this size.*

## Round 3 — on the rebuilt pithead

**What it said it looked like.** A desk hole-punch. Then a microscope, then a cannon on a carriage.

Three rounds, three different wrong answers — washing machine, stove, hole-punch. That progression
is itself the finding: each round the wrong answer got further from *domestic* and closer to
*apparatus*, and none of them landed on *mine*. At 30 px a specific machine may simply not be
nameable; what the sprite can be is unmistakably **not the other two buildings**, and that it now
is.

| Finding | Done |
| --- | --- |
| No spokes and no hub — a plain donut is an eyelet or a bolt head, never a sheave | **an axle straight across the bore.** One axis-aligned bar, so it costs no anti-aliasing, and 2 px of white survives above and below it at `--dpr 1` |
| The back strut is a stroke too thin to exist — grey and intermittent, and never visibly lands | **thickened to 3.5 px and run down into the housing**, so the join is covered rather than terminating in white |
| The base's long white band collides with the turret's plinth — cover the top halves and they are the same sprite | **the deck edge now stops at 60% width.** A full-width band through a slab is what a plinth is |
| The ore mouth breaks the bottom contour | **raised**, on a 2 px threshold |
| Grey at real size is a failure state for this direction | strut and deck both thickened; the ring's bore went 5 px → 6 px |
| Feet fuse into the slab with no white break | the housing's own keyline already separates them; left as drawn |

**Not acted on, deliberately:** *build a tall narrow tower with daylight under the wheel.* The box
is 30 px and it is square. A tower tall enough to read as a tower leaves the engine house about six
rows, which is not enough for a top surface, a front face and a mouth — and #81 requires the top
surface and the front face both. The squat frame is the cost of the box, not an oversight.

## What changed, and why it is a pithead

The mass is now **solid ink** and the **counterspace carries the identity** — the wheel's bore, the
gap between the splayed legs, the deck edge, the ore mouth. Not one of them is a framed rectangle,
which is precisely what the wall already is, and white is what survives on an ink-ore tile.

The wheel is carried on **legs that reach the ground**, with a **back-leaning strut**. That fixes
three things at once: it attaches the wheel, it puts the whole sprite back in one projection, and
the leaning A-silhouette is off the vertical axis of symmetry that both the wall and the turret sit
on. Spokes are gone; the wheel is a thick ring with one large bore, which is what survives.

## Distinguishability at 30 px

The three buildings now separate on the shape of the top edge alone, which is the only cue that
survives at this size:

| | Silhouette | Symmetry |
| --- | --- | --- |
| wall | flat slab, edge to edge | bilateral |
| turret | solid round crown over a stalk | bilateral |
| **miner** | **hollow ring on a leaning frame** | **none** |

Rounds 1 and 2 both found **miner-vs-wall** to be a genuine failure — the same black-frame-around-
white mark, and on ore the miner degraded *into* the wall. The redesign was for that, and round 3
confirmed it fixed: "different silhouette family entirely, no concern."

Round 3 then found the collision had moved to **miner-vs-turret**, and only below the waist: both
were a wide black plinth with one long white bar through it. Shortening the deck edge is the answer
to that. Above the waist the two have never been at risk — a hollow ring on a leaning frame against
a solid crown on a stalk.

Worth stating plainly, since three reviewers all reached for it: **the asymmetry is the single most
valuable thing this sprite has.** It is the only one of the three that is not bilaterally
symmetric, and that alone separates it at a glance. Nothing should be "tidied up" at the cost of
it.

## Open, and shipping anyway

- **Nobody has yet looked at it and said "mine".** Three reviewers named three different objects.
  What is settled is that it is not the wall and not the turret, that it is machinery rather than an
  appliance, and that it survives ore. Whether the pithead itself lands is the author's call in the
  game, and it is the thing to re-check first.
- **The strut still anti-aliases** along its whole length — it is the one member that has to lean.
  That is resolution, not a defect to fix (#77), and it is load-bearing for the asymmetry.
- **The ore mouth loses its arch at `--dpr 1`**, becoming a plain white notch. It still reads as an
  opening, which is all it has to do.
- **The ink is 53% of covered pixels, which is heavy** — the sprite is a black mass with white cut
  into it, the inverse of where round 1 started. That was deliberate and is what makes it survive
  the ore; it is also what makes it the darkest of the three buildings.
- The final call is made by looking at it in the game, on real ore, beside the finished wall and
  turret — both of which were still being rebuilt while this was drawn.
