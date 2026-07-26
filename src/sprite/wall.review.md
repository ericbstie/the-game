# wall — review

The buildable wall was redrawn. It was an **elevation of a brick face**, one drawing, `facings: 1`;
it is now a **wall top seen from above**, drawn from the occupancy of the tiles around it. What
follows is why, what the change cost, and what is now load-bearing about it.

The per-sprite review loop is deliberately short here — one reviewer pass at the end, not the three
rounds the first version had. What replaced the rounds is the run harness: every judgement below was
made on a line, a column, an L, a closed ring and a solid block of real walls painted through the
shipped `drawWorld`, at dpr 1 and dpr 2, rather than on a tile.

The mask went from four bits to twelve after that pass — #90, and the whole of *The mask* and *The
inner corner* below. Both defects it fixes are **absences**, invisible on a single tile and invisible
in a call log, so they are pinned in `wall.test.ts` as well as looked at: every fill this sprite makes
is an axis-aligned integer rect, which means replaying them into a grid reproduces a bake exactly and
"is this corner white?" has an answer under `bun test`.

## What changed, and why the old one had to go

The old sprite was a good brick elevation and the wrong object. Drawn face-on, a run of them was a
row of brick *walls* standing shoulder to shoulder — you never saw a top, so nothing said the run was
one mass, and nothing could say where a mass ended. The author's reference is a top-down colony sim:
the top surface dominates, brick appears only where the mass is cut, and a shared face shows nothing
at all. That last clause is what the old sprite could not express, because it had no way to know its
neighbours.

## Top against side, without colour

The reference carries top-vs-face in colour — pale stone above, brick red on the cut faces. #76 §1
grants two colours and neither is one of those, so the contrast is carried by **value and mark
density** instead:

| | ink | marks |
|---|---|---|
| **top surface** | ~10% | 1 px hairlines: two bed joints at a pitch of 15 and short head joints between them |
| **cut face** | ~80% | solid ink with the mortar knocked out white |
| **outline** | solid | 1 px, on cut edges only |

That is an order of magnitude apart in coverage, which is what makes them read as different surfaces
of the same object before any detail resolves — and it is the natural top-down convention anyway: the
top catches the light, a vertical face is in shadow. Solid ink with white knocked out of it is also
already the 30 px family's idiom (`generator.ts` names it: *"solid black masses with white windows cut
out"*), so the wall now belongs to the same set of nibs as the miner and the turret.

**The top is joints and nothing else — no tone**, and it is bounded on both sides. Bare paper is not
enough, because the floor is bare paper too: a closed ring would come out as two concentric brick
bands with white on both sides of them and nothing saying which side was the wall. That case is the
reason the marks exist at all, and it is why the ring is in the harness. A halftone is not an option
in the other direction: at the value that reads as tone it lands on the room wall's hatched face, and
those two are on screen together.

## The three faces are three depths

Near 8 px, flanks 5, far 3. That does three jobs at once:

- **It is the light and the projection.** You see a lot of the face turned toward you, a strip of each
  flank, and barely anything of the far side. A tile with four equal faces reads as an elevation of a
  box, not as a top.
- **It is the line-weight hierarchy** the style wants; one width everywhere is CAD linework.
- **It resolves corners.** Where two cut faces meet they butt at a step rather than crossing bonds
  into mush, and the deeper face wins, which is the correct occlusion.

The far face carries **no brick at all** — from up here it is a shadow under the arris. The flanks
carry bed joints only: five pixels holds a silhouette, one course and an arris and nothing more. A
head joint was drawn across them and had to come out — crossing a bed joint in a 3 px face it made a
white capital I every five pixels, a chain of marks rather than a wall.

## The mask

`facing` is **neighbour occupancy**: which of the twelve tiles ringing the 2×2 footprint hold another
**wall**. 0 is a wall standing alone with all four faces cut; all twelve set is a wall buried in a
mass with none. 4,096 variants, of which 47 are reachable — a bit is only meaningful in combination
with its neighbours — and bakes are lazy per variant, so a base pays for the arrangements it actually
stands in.

It began as four bits, one per side. That could not express two things, both of which shipped as
defects and are the subject of #90:

- **A side is two tiles long and a neighbour can cover one of them.** Walls are placed per tile
  (`cursorTile` is `tileOf`, snapping to no footprint), so two walls butt while their origins sit one
  tile out of step. A per-side bit has to call that half covered or cut and is wrong either way:
  covered suppresses a face that is genuinely exposed — 15 CSS px of side drawing nothing at all —
  and cut draws masonry into the middle of a solid mass. Per tile, each half answers for itself.
- **A concave corner has no face of its own.** At the inner corner of an L or a ring the two
  neighbours' faces stop at their own box edges and meet only at a point; the tile in the angle draws
  neither, because it has a neighbour on both of those sides. The four diagonals are what tell it the
  angle is empty. See *The inner corner* below.

Derived in `drawWorld` (`wallFacing`), off a set of the tiles walls cover, built **once per frame**
before the structure loop. Three things about it are deliberate:

- **The set holds every tile a wall covers**, and occupancy is asked one tile at a time. A `tx ± 2`
  test would be wrong — it assumes an alignment nothing enforces — and so, for the same reason, is
  any test that answers for a whole side at once.
- **Off-screen walls are in the set.** A run does not stop at the viewport edge, and a wall whose
  neighbour was culled would grow a brick face that is not there, which pops as the camera moves.
- **Only walls count.** A miner butted against a wall does not cover it — different building, and the
  wall's face is still a cut face where it meets one.

Nothing about this reaches the wire, the sim, or the `SpriteSubject` contract. It is the `facing` axis
used for what a wall actually has instead of an orientation it does not.

## The inner corner

Where two neighbours meet with nothing in the angle between them, the sprite fills the corner: a
solid patch, the flank's width by the depth of whichever band it closes against — 5×3 against the far
band, 5×8 against the near one. It is the two faces butted, and at that size there is nothing to
knock mortar out of.

The rule is per tile of the footprint and identical for all sixteen tile-corners: **both flanking
tiles wall, the diagonal not**. It cannot fire on a corner interior to the sprite's own 2×2, because
that diagonal is always the wall itself, and it does not fire inside a solid mass, because there the
diagonal is occupied. It also closes the corner a half-overlap turns through, which is the same
concave angle arriving mid-side rather than at a box corner.

Unfilled, this was a white bite out of every enclosure a player built — four per courtyard — and it
was the more visible of #90's two defects by a wide margin.

**The ghost takes the mask too**, so laying a wall onto the end of a run previews the join it will
make. The run it joins keeps its own faces until the placement lands — the ghost is a preview of the
tile under the cursor, not of a structure list the server has not agreed to.

## The period rule, which now binds in two directions

Nothing in the drawing has a period of 30. That was the whole design of the old sprite and it binds
harder now, because a run can go *down* the screen as well as across:

| feature | pitch | phases | clear of |
|---|---|---|---|
| near-face head joints | 10 | 2 and 7 | columns 0, 29 |
| flank bed joints | 10 | 6 | rows 0, 29 |
| top bed joints | 15 | 12 | rows 0, 29 |
| top head joints | 15 across | 3/18 and 10/25 | columns 0, 29 |

Every phase sits clear of both box edges, so two neighbours never double a joint into a thicker line
at the seam and never leave a gap either. Verified by rendering rather than by argument: in a six-wide
butted run and a four-deep butted column the joins cannot be located by eye while knowing where they
are.

**One period of 30 is spent deliberately.** The top's bond staggers over two courses, and two courses
of 15 are the box — so the top surface repeats every 30 down the screen. The alternatives were both
worse: three courses at a pitch of 10 closes over the box without a 30-period but puts two full-width
rules across every top at the weight and spacing of the near face's own courses, and a run then reads
as a brick wall seen face-on, which is the exact thing this drawing exists to stop being; two courses
at a pitch of 10 repeats every 20, which does not divide 30 and breaks a vertical run at every join.
The 30 is spent on the three faintest marks in the sprite, against a bond at 10 and a course at 10 on
the faces, which are what the eye actually finds.

## Measurements

- **Zero anti-aliasing, at dpr 1 and dpr 2.** Every edge is an integer and axis-aligned; nothing
  curves. Re-measured on a rendered scene rather than on the bakes, where the harness's `grey` count
  cannot tell paper from a softened edge: across the wall boxes of a ring at dpr 1, **0 pixels are
  anything but 0 or 255 at full alpha**.
- **Ink is 42% of the covered pixels across all 4,096**, from 55% on the isolated wall down to 11% on
  the fully enclosed one. That gradient is the point: a wall that is all cut faces is heavy, and one
  buried in a mass is nearly all top. The average rose from 35% with the mask, because a half-covered
  side and a filled inner corner both add ink to variants that had none.
- The harness reports *4096 bake(s) touch the edge of their box* on every render. That is the point:
  a wall that stopped short of its box would leave a gap between neighbours in a run.
- **4,096 bakes at dpr 2 render in 2.3 s**, so the sheet stayed usable when the variant count went up
  by 256×. The sheet itself samples 48 of them (`MAX_PANELS`), as it already did for ore.
- **The frame budget did not move**: 6.19 ms, 37.1% of a 16.67 ms frame at the M5 worst case, against
  6.19 ms before. `wallFacing` went from eight set lookups per wall to twelve, once per frame.
- The whole box is filled with paper, so the harness's `grey` count is the white top and not
  anti-aliasing — the two are indistinguishable to `measurePixels`. A wall occludes the ore under it,
  which is why the fill is there.

## Distinguishable from the miner, the turret and the room wall

- **vs miner and turret** — both are solid ink masses standing clear of their box edges with a curve in
  them. This is a light field with no curve anywhere that bleeds to whichever edges are cut. Tone and
  silhouette separate them before any detail resolves.
- **vs the room perimeter**, which shares the 30 px box *and* the subject — that one is a diagonal grey
  hatch, "different frequency, different value, different material", and it is an unfolded elevation
  whose cap always points away from the middle of the arena. This one has no orientation beyond its
  neighbours.

## Standing notes for whoever touches this next

- **Judge a run, not a tile.** The scratch harness that butts walls into a line, a column, an L, a ring
  and a solid block is what caught every defect in this drawing; the contact grid caught none of them.
  Add **two walls one tile out of step** to that set: it is the arrangement a per-side mask got wrong,
  it is placeable in the shipped game, and nothing else in the harness produces it.
- **Do not put a mark on an edge that has a neighbour.** Not an outline, not a joint, nothing. That is
  the entire mechanism by which two tops merge instead of showing a seam.
- **Keep every phase clear of columns 0 and 29 and rows 0 and 29**, and every pitch a divisor of 30.
- **Do not let a flank joint land on a top bed joint.** They coincided at row 12 once, and the result
  was a white notch at each end of a black hairline — a rule broken into three pieces.
- **Keep every edge on an integer.** It is what buys 0% anti-aliasing, it is checked on every render,
  and it is also what makes `wall.test.ts`'s rect rasteriser an exact stand-in for a bake.
- **Ask occupancy per tile.** Any answer given for a whole side at once has to guess at a half-overlap,
  and any corner drawn without consulting the diagonal fills one that should have stayed open.
- **Do not add tone to the top surface.** It is the largest thing in the sprite and has to stay the
  lightest, or the contrast that carries top-against-side goes with it.

## Contradicts, and what it means

- **#76 §2 and #81 both list the wall as "elevation — top surface and front face both visible."** It is
  still both, and it is still orthographic and identical everywhere on screen — but the *balance* has
  inverted: the top now dominates and the front face is a band. A run of the old drawing could not read
  as one mass, which is what the author's reference asks for, and no amount of redrawing a single
  elevation tile reaches it. The miner and the turret are untouched and remain true elevations, so the
  wall is now the one 2×2 building drawn top-dominant. Worth an explicit ruling.
- **#76 §5 / #81 "structures do not change appearance"** is about *damage*, and still holds — there are
  no damage states here and the health bar still carries damage. The variants are a property of where a
  wall stands, not of its condition.
- **#87** was the same class of problem for ore and is now closed too. Both solve it through the
  variant index, with no change to the `SpriteSubject` contract — but ore's mask is four bits against a
  patch that is one tile per cell, and this one is twelve against a footprint two tiles to a side. The
  generalisation, if a third ever wants it, is that a sprite covering *n* tiles needs occupancy for the
  4n + 4 tiles around it, and four bits is only ever enough at n = 1.
