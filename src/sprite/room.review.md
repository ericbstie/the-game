# room — review

The arena's perimeter wall and the escape door. Seven drawings of the wall, four of the door, and
three review rounds (ADR 0002 §3). The reviewer is advisory; what it said is recorded whether or not
it was taken, and the places where it was overruled say why.

## What was decided, and why

**The unfolded box is one drawing and four rigid rotations.** #76 §2 makes the perimeter the single
exception to the game's orthographic projection: the walls lean away from the middle of the arena
and lie flat, like a carton cut at the corners and pressed open. So `draw` works in *wall space* —
`u` along the perimeter, `v` from the wall's top edge (0, outermost) to its base (30, where it meets
the floor) — and `UNFOLD` turns it onto each edge. All four matrices have determinant +1: they are
rotations, never mirrors, so it is one rigid wall shown four ways rather than four drawings that
happen to agree. What a player sees is that the cap is at the **top** of the screen on the north
edge and at the **bottom** on the south — the opposite of every other sprite in the game, and what
makes the four edges read as one room. Verified numerically by two reviewers: `rot90(north) = west`,
`rot270(north) = east`, `rot180(north) = south`, **zero differing pixels** in every case.

**The face carries the mass; the cap is only a cap.** This was the other way round for three
drawings and it is what kept the sprite reading as trim. With a 12 px slab of cornice over a face
that was 73% paper, the largest black shape in the sprite was its least important part, and the only
part that is actually *wall* was the same value as the floor it stands on — so the wall did not
occupy space, it was a line drawn on the paper. The cap is now 5 px, the face 18, and the face is
hatched to a measured 40% ink.

**The band is opaque corner to corner** — no transparent pixel. It joins the Y-sort, so the near
wall has to actually cover a player standing against it; and the run pushes both a north and a west
segment into the same box at each corner, where an opaque second segment covers the first instead of
crossing it into a mesh.

**Nothing has a period of 30 except the pier, which is meant to.** Every band runs the full length
and continues straight through a join; the hatch's pitch divides the box *and* its strokes are six
times longer than that pitch, so six of them cross any column and the family reads as continuous
rather than as one closed cell per box. The pier is the deliberate exception — it is the bay rhythm,
and a bay is exactly one box wide.

**It must not be read as a buildable wall**, which shares the 30 px box and is often on screen beside
it. That one is masonry: a *light* field of white bricks in a staggered bond under a solid black cap.
This is its inverse — a dark hatched field under a thin cap, no bond anywhere. Checked at every
round: "stretcher-bond horizontal courses vs 45° hatch, no material confusion."

## The face: four drawings thrown away, and what each one taught

**30 px of depth leaves room for horizontal bands or for one row of marks along the run, and a single
row of identical marks under a heavy black band is a manufactured product, not a wall.**

1. **Panelled dado** — cells closed on four sides. Read as **sprocket holes in a strip of film**. A
   mark that bounds a cell makes a cell.
2. **Scribe lines** — the same marks cut free of the skirting. Read as a **comb**, on a band far too
   light: a 7 px cornice over mostly white paper is a decorative rule.
3. **Upright hatching with cycling stroke lengths**, meant to look hand-laid. Read as a **measuring
   tape** — varied tick lengths is exactly what a ruler has, so the variation made it worse.
4. **Diagonal hatching with cycling weights and lengths.** The diagonal was right and stayed; the
   cycling was measured by a fresh reviewer as *three unlike marks in a repeating cluster* — a stamped
   pattern, not a hatch. **A hatch is a uniform family; its irregularity comes from the rasteriser,
   not from a cycle.**
5. **Bold diagonals, 2 px on a 6 px pitch.** Right coverage, wrong texture: bold alternating diagonals
   are **hazard tape**. The fix is fine and close — 1 px on a 3 px pitch — so the eye stops resolving
   strokes and sees a value.

Hatching on a large structure is granted by #76 §1, and this is the largest structure in the game.

## The door needed its edge, and this is the arithmetic

The exit is **936 world units along its wall**, so the door is tiled about **31 times in a row**. One
drawing of a door leaf would read as 31 doors; whatever the door is, it has to be a *length of gate*
that tiles into itself.

The harder constraint was orientation. `drawWorld` originally asked for one door variant on every
edge, so the first two doors had to survive a quarter turn, and both failed:

- **A studded plate.** Reviewer: punched holes with the floor showing through, "the precise signature
  of a void".
- **A plate crossed by one white strap in each axis.** Reviewer, blind: ***"a chocolate bar."*** And
  because the floor is white paper, white inside a black plate reads as *see-through* — round 1 was
  four holes per box, round 2 was four panes.

The second reviewer supplied the proof rather than the taste: **the wall's profile is asymmetric top
to bottom**, so any tile that cannot tell which way is up is invariant under a vertical flip, and **a
vflip-invariant tile cannot match both ends of an asymmetric wall.** "Carry the cap and the floor
line through" and "one orientation-free door" are mutually exclusive — arithmetic, not a design
tension.

The integrator took the upstream line. The sprite ships **eight facings** — 0–3 the walls, 4–7 the
same edges with the door — and the caller asks for `DOOR + facing`. With the edge in hand the door is
a real one: the cap runs on above and thickens into a **head**, a 2 px white **soffit** sets the gate
back behind it, the **skirting rule, white gap and ground line continue at exactly the wall's
depths**, and the gate itself is **boarded** — near-solid ink with hairline joints and a **ledger**
braced across it, because a horizontal brace is what stops a row of boards being a row of stripes.
The boards are laid so the black left whole at the box edge is double width, which puts a **stile
every 30 px** — the way a long boarded gate is really built, and the jamb where the run meets the
wall.

## Measured, not argued

Butted runs of 24 rendered at dpr 1 and dpr 2, plus ink profiles read off the bitmap.

- **The join cannot be located, and now not even by measurement.** Every column across a
  four-segment run carries **16 units of ink**, seam columns included — the hatch strokes are long
  enough to wrap, so a stroke that entered the neighbour's right edge is drawn here too. An earlier
  version had strokes exactly one pitch long, which closed each box into its own cell and was the
  single biggest driver of "a row of identical stamps".
- **The run has a beat.** Column ink over one interior tile at dpr 1:
  `16 ×11 · 28 28 28 · 16 ×16` — the pier at **1.75× the baseline**. Before the pier this measurement
  was constant for every column of a 720 px run.
- **The wall's profile, dpr 1, top to base:** `100 ×5` (cap), `40 ×18` (the hatched face — one even
  tone, which is what a uniform hatch should measure), `100 100` (skirting rule), `0 0` (the white
  gap), `100 100 100` (ground line).
- **The door's profile, dpr 1:** `100 ×6` (head), `0 0` (soffit), `73 ×5` (boards), `0 0` (the
  ledger), `73 ×8` (boards), then `100 100 · 0 0 · 100 100 100` — **the same three numbers as the
  wall**, which is what "the floor line runs through the door" means when it is checked rather than
  claimed.
- **dpr 1.5 was checked** (the README asks for it on a 30 px box).

## Round 1 — "a length of knurled metal edging"

Blind: ***"a length of knurled metal edging / twill ribbon trim — with a perforated grille plate
spliced into the middle."*** **Verdict: fix these things first.**

1. ***The door is a black rectangle with a dot grid — it reads as a hole.*** It also destroyed the
   wall around it: cornice, both rules, hatch and floor line all terminated dead at the door edge.
   **Eventually taken in full**, once the wiring gave the door its edge.
2. ***The tile has zero vertical structure, so a run is a featureless extrusion.*** Measured
   per-column ink across a 720 px run as **constant for every single column**. **Taken:** the pier.
3. ***The corner does not close — a T-junction, not a mitre.*** **Not taken:** needs a ninth variant
   and a change to the caller. Reported.
4. ***The hatch is CAD linework.*** **Taken**, though the first attempt at the fix overshot — see
   round 3. It also asked that no 1 px ink hairline be left; **taken**.
5. ***Resolution-dependent ink weight.*** **Taken.**
6. ***Door studs are the only soft thing in the sprite.*** **Taken:** no curve remains in the door.
7. ***Perfect symmetry on the door.*** **Taken**, via the wiring.
8. ***Top-heavy hierarchy*** — raised as low priority and, in hindsight, the most important thing
   either of the first two rounds said. It took round 3 restating it as a measurement to land.
9. ***The hatch flips 90° between N/S and E/W.*** Judged defensible as a genuine unfolded box; passed
   again at round 3 as "acceptable and not distracting".

## Round 2 — "architecture now, but a dado rail rather than a room"

Blind: ***"a hatched frieze under a heavy cornice, broken into bays — architecture now, but a dado
rail rather than a room."*** The door, blind: ***"a chocolate bar."***

1. ***The door is a chequerboard and the stated fix did not land.*** Verified at pixel level. **Taken
   in full.**
2. ***The vflip proof.*** The finding that changed the wiring.
3. ***The pier reads as architecture at 2× and as a graduation tick at 1×*** — it sat at the same
   visual frequency as the hatch and the two averaged into a scale. **Taken.**
4. ***The pier is the identical perfect rectangle 24 times, with no cap, base or taper.*** Taken at
   the time as a splayed plinth — which round 3 then read as a thumbtack's foot and which came back
   out. The real fix was the aspect ratio.
5. ***Regression: the floor line got worse*** — 1 px of white does not separate the skirting rule from
   the ground line at dpr 1. **Taken:** the gap has its 2 px back permanently.
6. ***Door ink overshot the wall's.*** Addressed by giving the door a head, soffit, ledger and stiles
   rather than by matching values.

## Round 3 — a fresh reviewer, and the one that found the real problem

A **fresh** reviewer, not the one from rounds 1–2. Blind: ***"a length of diagonally-hatched trim
between two rules — hazard tape, or the striped border on a certificate"***, and with the pier,
***"a scale bar with graduations."*** The door: ***"a vent grille / air-brick."***
**Verdict: do not ship.**

1. ***The wall's face is the same value as the floor, so the wall has no body.*** Measured: a 12 px
   solid cap over a face at **27% ink** — 73% white paper, which is exactly what the floor is. "The
   wall therefore does not occupy space; it is a line drawn on the paper," and the largest black shape
   in the sprite was its least important part. **Taken in full**, and it is the finding that turned the
   sprite around: cap 12 → 5, face 11 → 18, face ink 27% → 40%.
2. ***The door is a 7-pixel grille*** — the most important object in the game was the shortest element
   in its own tile, a band four times wider than tall filled with vertical stripes. **Taken in full:**
   head 14 → 6, gate 7 → 15, joints down to hairlines so the field stays near-solid, and the ledger
   added. Its exact words for why: *"the brace is what stops stripes being stripes."*
3. ***There is no jamb, so the door reads as "the fill changed".*** **Taken** as the reviewer proposed
   it — a stile built into the tile edge, which tiles into a stile every 30 px and gives the splice a
   hard vertical.
4. ***The pier reads as a tack, not a pier*** — 4 px wide, 11 px tall, with a splayed foot that fused
   into the adjacent hatch stroke. **Taken:** 3 px, no foot, full face height. As the reviewer
   predicted, fixing the face's height did most of the work.
5. ***The "hatch" is three different marks at three different weights*** at alternating pitch — "a
   repeating cluster of unlike marks, which is precisely why it reads as a stamped pattern". **Taken:**
   one weight, one length, one pitch. The cycling introduced in round 1 came back out entirely.
6. ***The seam is directly findable every 30 px*** — strokes exactly one pitch long began flush at each
   box edge, closing each box into its own cell. **Taken:** strokes now run six pitches, so the family
   wraps. Column ink across a run is now uniform to the last unit.
7. ***Zero variation across 720 px — 24 byte-identical stamps.*** **Not taken:** selecting between
   plain-wall variants by segment index is the caller's to do; `pushRoom` passes only the edge.
   Reported. Note this is in direct tension with round 1 §2, which demanded the beat that makes the
   stamp visible; a regular architectural rhythm is the right answer and variants would refine it.
8. ***The corner has no treatment.*** **Not taken** — same reason as round 1 §3. Reported.
9. ***A 1 px hairline rendering hard while its 3 px neighbour anti-aliased.*** Folded into 5.

**Checked and found fine:** no colour, 251 neutral grey levels; the floor line across the door
"genuinely continuous… that part of the intent is delivered exactly"; facing consistency exact and
verified numerically at zero differing pixels; artefacts — everything hard-edged except the permitted
diagonals, no moiré, no bleed outside the box; and clearly distinct from the buildable wall.

**Round 4 was not run.** The changes above were verified by measurement against the specific defect
each was meant to fix, and by looking at butted runs on white paper at both ratios, but they have not
had a fresh pair of eyes. That is the first thing to do if this sprite is picked up again.

## Standing notes for whoever touches this next

- **Two findings are still open and both are the caller's, not the art's.**
  1. **The corner is drawn twice, not mitred.** `pushRoom` pushes a north segment and a west segment
     into the same box at each corner; the later covers the earlier, so the room's outer black does not
     turn the corner. A ninth variant drawn as a mitre, chosen for the four corner boxes, fixes it.
  2. **Every segment of a run is the same stamp.** Two or three plain-wall variants chosen by segment
     index — the `tileVariant` idiom `drawOre` already uses — would break that. Both reviewers raised
     it; neither can be fixed from inside a sprite module.
- **The door must keep its edge.** `facings` is 8 and the caller asks for `DOOR + facing`. Collapsing
  that back re-imposes vflip invariance, and a vflip-invariant tile cannot meet an asymmetric wall at
  both ends. Two drawings died proving it.
- **Do not put a row of marks along the run in the face.** Three attempts, three failures, all the
  same family — sprocket holes, a comb, a measuring tape. Tone is what works there; the beat belongs
  in the pier, which is one mark per box.
- **Do not flank the pier with white.** It was tried to make it stand out and it closed every bay into
  a discrete cell — the sprocket-hole failure returning by another route.
- **Do not give the hatch a cycle.** Cycling weight or length reads as a stamped cluster, not as a
  hand. A hatch is a uniform family and its irregularity comes from the rasteriser.
- **Keep the hatch strokes far longer than their pitch.** Strokes one pitch long close each box into
  its own cell and make the seam findable; that is measurable in the per-column ink profile.
- **Keep the mass in the face, not the cap.** A face at the floor's value is not a wall.
- **Do not take the 2 px white out of the floor group**, and **the door's floor group must stay
  byte-identical to the wall's** — that is what stops the door reading as a hole.
- **Keep every band boundary on an integer.** It is what holds 0% anti-aliasing everywhere except the
  hatch, at every ratio.
