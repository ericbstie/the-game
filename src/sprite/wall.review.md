# wall — review

The buildable wall was redrawn. It was an **elevation of a brick face**, one drawing, `facings: 1`;
it is now a **wall top seen from above**, sixteen drawings on a neighbour mask. What follows is why,
what the change cost, and what is now load-bearing about it.

The per-sprite review loop is deliberately short here — one reviewer pass at the end, not the three
rounds the first version had. What replaced the rounds is the run harness: every judgement below was
made on a line, a column, an L, a closed ring and a solid block of real walls painted through the
shipped `drawWorld`, at dpr 1 and dpr 2, rather than on a tile.

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

**The top is joints and nothing else — no tone.** Open paper alone was tried first and fails one test
that matters: the floor is white paper too, so a ring of walls came out as two concentric brick bands
with white on both sides of them, and nothing said which side was the wall. A halftone was not an
option in the other direction: at the value that reads it lands on the room wall's hatched face, and
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

`facing` is a 4-bit neighbour mask: 1 north, 2 east, 4 south, 8 west, set where another **wall** abuts.
0 is a wall standing alone with all four faces cut; 15 is a wall buried in a mass with none. Sixteen
variants covers every case exactly, corners included — an L's corner is `EAST | SOUTH`, and the two
faces it does not draw are precisely the two that are interior.

Derived in `drawWorld` (`wallFacing`), off a set of the tiles walls cover, built **once per frame**
before the structure loop. Three things about it are deliberate:

- **The set holds every tile a wall covers, and a face counts as covered when any tile of the strip
  alongside it is in the set.** A `tx ± 2` test would be wrong: nothing snaps a wall to its own
  footprint — `cursorTile` is `tileOf`, per tile — so two walls can butt while their origins sit one
  tile out of step. That join is real, and the strip test is the one that sees it.
- **Off-screen walls are in the set.** A run does not stop at the viewport edge, and a wall whose
  neighbour was culled would grow a brick face that is not there, which pops as the camera moves.
- **Only walls count.** A miner butted against a wall does not cover it — different building, and the
  wall's face is still a cut face where it meets one.

Nothing about this reaches the wire, the sim, or the `SpriteSubject` contract. It is the `facing` axis
used for what a wall actually has instead of an orientation it does not.

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

- **Zero anti-aliasing, at dpr 1 and dpr 2.** All sixteen bakes contain exactly two values — 0 and 255
  — at full alpha, measured off the real bakes. Every edge is an integer and axis-aligned; nothing
  curves.
- **Ink is 35% of the covered pixels across all sixteen**, from 55% on the isolated wall down to 11%
  on the fully enclosed one. That gradient is the point: a wall that is all cut faces is heavy, and one
  buried in a mass is nearly all top.
- The harness reports *16 bake(s) touch the edge of their box* on every render. That is the point:
  a wall that stopped short of its box would leave a gap between neighbours in a run.
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
- **Do not put a mark on an edge that has a neighbour.** Not an outline, not a joint, nothing. That is
  the entire mechanism by which two tops merge instead of showing a seam.
- **Keep every phase clear of columns 0 and 29 and rows 0 and 29**, and every pitch a divisor of 30.
- **Do not let a flank joint land on a top bed joint.** They coincided at row 12 once, and the result
  was a white notch at each end of a black hairline — a rule broken into three pieces.
- **Keep every edge on an integer.** It is what buys 0% anti-aliasing, and it is checked on every render.
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
  no damage states here and the health bar still carries damage. Sixteen variants are a property of
  where a wall stands, not of its condition.
- **#87** is the same class of problem for ore and stays open. This solves it for walls only, through
  the variant index, with no change to the `SpriteSubject` contract — an ore tile would need the same
  derivation against a different occupancy source and a different number of variants.
