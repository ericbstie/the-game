# miner — review

Box **30** (the 2×2 footprint at `TILE` 15), `facings: 1`, `frames: 1`. A building has no
directions and no animation, so both index axes are spent: one bake, one variant.

Reviewed per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)
by subagents that read `miner.sheet.png` and looked at it, alongside `wall.sheet.png` and
`turret.sheet.png` — the other two buildings that share this footprint. Readability judged on
panel 2, artefacts on panel 3. Findings are advisory; what was done about each is recorded below.

Also checked at `--dpr 1`, the density with the fewest pixels to work with. The sheave's bore, the
tower, the raked back-leg, the deck edge and the ore mouth all survive it. The mouth loses its arch
at 1× and reads as a plain notch, which is all it has to do.

**Even-weight ink is accepted for the buildings**, decided across the set rather than here: at 30 px
every attempt at a swelling-and-tapering contour either disappeared or became a sub-pixel smear.
Rubber-hose modulation is a character property. Round 1 asked for varied weights and got them; they
have since flattened out as members were reproportioned, and that is fine.

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
| Uniform stroke weight reads as CAD, not ink | yes | varied at the time; later **overturned across the set** — see above |
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

## Round 4 — the first real three-way comparison

Turret and wall had both shipped by now, and `ore-metal` existed, so this round compared against
the finished siblings and the actual ground rather than against guesses.

**What it said it looked like.** A stapler. Then a desk hole-punch, then a microscope.

Its diagnosis of *why* was the useful part, and it was proportional rather than decorative:

1. **The axle read as a prohibition sign.** A ring crossed by a full-width bar is ⊖ — "no entry".
   That is what the eye resolves first, and once it lands there the shape never re-reads as a
   sheave. Round 3 had asked for the axle; round 4 showed the cure was worse than the disease.
   **Removed.**
2. **The pithead proportions were inverted.** A pithead reads because a *small* wheel sits at the
   apex of a *tall, open* frame. The wheel was the biggest element in the sprite, sitting on a
   stubby A-frame, and offset left — so it read as bolted to the side of the housing rather than
   crowning it. **The sheave is now small and centred over the house, on a longer frame.**
3. **The back strut tapered to a sub-pixel point and landed on nothing** — a stray diagonal scratch,
   already only a grey ghost at real size. **Replaced by a raked back-leg** of constant width that
   runs down *into* the house, so its foot is covered rather than terminating in air.

Two more taken: the ore mouth was floating above the ground line and now sits on it, and the
sheave's keyline was widened to 1.5 px so its rim does not clump into the tower head at real size.

**On the ore, it corrected my own assumption.** Metal ore turned out to be *small discrete specks*
on white, not a solid ink field. So the base is safe on grounds of mass-versus-speck alone, and the
keyline is doing real work only at the edges. The exposure is the opposite of what I had assumed:
the *superstructure* is at the ore's own noise frequency, and it is the identity that is fragile on
a dense patch, not the silhouette.

**On distinguishability it overruled the turret agent.** The turret's parting note was that the two
are separated mainly by the top edge. Round 4's finding: the top edge is the *third*-best separator.
The first is **value** — the turret is an outline drawing, white-dominant, and the miner is a solid
black mass — and the second is **symmetry**. Both are faster than silhouette detail at 30 px. That
is recorded here because it changes what must be protected: not the protrusions, but the black mass
and the asymmetry.

Residual overlap it flagged and I have not chased: **the bottom third**. A wide plinth with a white
band in it is what both sprites do. Half-occluded, they are close.

## Round 5 — a bug, not a taste call

This reviewer measured the baked pixels to back up what it was seeing, and found something no
amount of looking had caught in four rounds.

**The sprite was three unconnected masses.** A 1 px white seam under the sheave, and a **full-width
white band** between the whole headframe and the roof. The sheave touched nothing; the tower and
the back-leg both stopped 1 px short of the house they were supposed to land in. At dpr 2 those
seams render as crisp 2-device-px white lines — they do not close at any density.

The cause was my own keyline. `inked` laid the white *and* the black for one shape at a time, so
each shape's keyline fell across the shape drawn before it — protecting the sprite from the ore on
the outside and cutting it to pieces on the inside. Every earlier round had read those seams as a
drawing decision.

**Fixed by splitting the draw into two passes** — every keyline first, every ink mass second. The
ink then closes each internal seam and the white survives only on the outside, which is the only
place it was ever for. Both shipped siblings are single connected masses; this one now is too.

The same reviewer found the **letterform** the connectivity bug had been hiding: a ring over two
uprights joined by a mid-height crossbar is a capital **A**, and it read as a stamped monogram
before it read as a machine. The brace has moved high and short, stopping inside the back-leg
rather than crossing it, which is also where a real headframe braces.

It also called two things settled that should not be touched again: **the wheel's size and its
position over the house centre**, and **the 4 px bore** — which is at the size floor and is the one
thing keeping the head-on-a-body reading from firing. Nothing goes back inside that bore.

One risk it raised that this sprite cannot answer alone: **the ore mouth is a notch, not an enclosed
hole**, so a single ore speck under it plugs it. That needs a real miner-on-ore composite to judge,
which no sheet in this harness produces.

## What changed, and why it is a pithead

The mass is now **solid ink** and the **counterspace carries the identity** — the wheel's bore, the
gap between the splayed legs, the deck edge, the ore mouth. Not one of them is a framed rectangle,
which is precisely what the wall already is, and white is what survives on an ink-ore tile.

The wheel is carried on **legs that reach the ground**, with a **back-leaning strut**. That fixes
three things at once: it attaches the wheel, it puts the whole sprite back in one projection, and
the leaning A-silhouette is off the vertical axis of symmetry that both the wall and the turret sit
on. Spokes are gone; the wheel is a thick ring with one large bore, which is what survives.

## Distinguishability at 30 px

Measured against the **finished** wall and turret, not against guesses. In the order the eye
resolves them:

| | Value | Symmetry | Top edge |
| --- | --- | --- | --- |
| wall | repeating field, edge to edge | bilateral | flat |
| turret | **outline** — white-dominant, ink at the contours | bilateral | flat, unbroken |
| **miner** | **solid black mass** | **none** | broken by the headframe |

**Value first, symmetry second, top edge third.** That ordering is round 4's, and it matters: it
means the two things to protect are the black mass and the asymmetry. Hollowing the miner out into
an outline to match its neighbours would throw away the strongest separator it has, and so would
tidying the raked leg into something symmetrical.

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

- **No reviewer has looked at it cold and said "mine".** Five rounds produced five different wrong
  answers — washing machine, stove, hole-punch, stapler, the letter Å — each one further from
  *domestic* and closer to *apparatus* than the last. What is settled is that it is machinery, that
  it is not the wall and not the turret, and that it survives the ore. Whether *pithead* specifically
  lands is the author's call in the game, and it is the first thing to re-check.
- **The ore mouth is a notch, not an enclosed hole.** One ore speck under it plugs it. Judging that
  needs a miner-on-ore composite, which this harness does not render — flagged rather than fixed.
- **The raked leg anti-aliases** along its whole length; it is the one member that has to lean. That
  is resolution, not a defect (#77), and it is load-bearing for the asymmetry.
- **The ink is 59% of covered pixels, the heaviest of the three buildings.** Deliberate: value is
  the fastest separator at this size and the black mass is what the miner owns.
- The final call is made by looking at it in the game, on real ore, beside the finished wall and
  turret.

## Standing notes for whoever touches this next

- **Never lay a keyline shape-by-shape.** Two passes — all white, then all ink — or the sprite comes
  apart into floating pieces that four rounds of looking will read as intentional.
- **Do not shrink the bore or put anything inside it.** At 4 px it is at the size floor, it is what
  stops the sheave reading as a head, and the one thing tried inside it — an axle across the full
  diameter — turned the ring into a prohibition sign.
- **Do not hollow the housing into an outline.** That is the turret's move, and value is the
  strongest of the three separators.
- **Do not tidy the raked leg into symmetry**, and do not put the brace back at mid-height. The
  first is the second-strongest separator; the second is the letter A.
