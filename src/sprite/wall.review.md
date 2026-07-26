# wall — review

Three rounds. The reviewer is advisory (ADR 0002 §3); what it asked for is recorded here whether or
not it was taken, and the two places where it was overruled say why.

## What was decided, and why

**`facings: 1`.** `README.md` leaves the count to me. A wall has no variants: #76 §5 cut structure
damage states, so a health bar carries damage, and there is no orientation to pick — the sprite is
symmetric about its vertical axis and its box is exactly its footprint.

**Elevation inside a footprint-sized box.** A true elevation of a 30-deep, 30-tall wall would be 60
px tall; the box is 30. So the top surface is foreshortened into a band and the front face takes the
rest. Every other 2×2 building has the same constraint.

**Ink reaches all four edges of the box**, so `sprite:sheet` reports `1 bake(s) touch the edge of
their box` on every render. That is the point: a wall that stopped short of its box would leave a
gap between neighbours in a run.

## The tiling problem, which drove the whole design

Players lay these edge to edge, and `draw` cannot see its neighbours — so seamlessness has to come
out of the sprite alone. Two failure modes had to be avoided at once: a **seam** every 30 px, and an
**obviously identical stamp**.

The resolution is that nothing in the drawing has a period of 30:

- The courses, the cap and the base run the **full width**, so they continue straight through a join.
- The bond repeats every **10 px**, which divides the box.
- The bond phases (2 and 7) sit **clear of both box edges** — no vertical ink in column 0 or column
  29. Two neighbours therefore never double a head joint into a thicker line at the seam, and never
  leave a gap either. The brick straddling a join is a full-length brick like every other.

The cost is that the left and right silhouette is inked only where a bed joint reaches it. There is
**no phase that both tiles invisibly and closes both sides**: inking the edges puts a doubled 2 px
vertical at every join, which is a worse artefact than a dashed edge. Round 1 confirmed the trade
was made the right way round.

Verified by rendering runs of 8 at dpr 1 and dpr 2, and an L, rather than by argument. The reviewer
independently built its own butted row and reached the same conclusion.

## Round 1 — the staggered bond

Reviewed the first version that got past two rejected attempts: a **stacked** bond read as a
**six-pane window** at 30 px, and tightening it to three columns turned it into a **noughts-and-
crosses grid**. Both were thrown away. The half-pitch offset between courses is what made it read as
masonry.

**Verdict: pass, nothing must change.**

- First impression, stated blind: *"a low brick wall, seen face-on, with a heavy black capstone
  across the top."* Not a window (a window needs a frame on four sides and 2–3 large panes; this has
  12 small cells in offset rows), not a grid (every vertical is a 5 px stub, not a full-length
  lattice line), not a barcode (the dominant lines are horizontal), not a crate.
- **Seam: none.** Measured off the bake — head joints at x = 2, 12, 22 on odd courses and 7, 17, 27
  on even, period exactly 10, offset exactly half a brick, no ink at x = 0 or x = 29. In a 6-wide
  render it could not locate the joins by eye while knowing where they were.
- **Artefacts: none.** Zero anti-aliased pixels in the whole 60×60 bake — the only one of the three
  buildings with no grey fringing (the miner has AA on the funnel diagonals, the turret on the
  dome). Cap, courses and joints all measured exact, not one band a pixel off.
- **Distinct from the miner and the turret: no risk either way.** The miner has a triangular hopper
  breaking its top edge and a large black circle low down; the turret is narrow, vertical and domed
  and does not fill its box. The wall is the only one of the three that is a plain full-width
  rectangle with a straight top, and the only one that is a light field rather than a solid ink
  mass.
- **Caveat it raised about panel 3:** the magnifier scales 60 px by 7.97, so some lines land on 8
  display pixels and some on 7. Apparent unevenness in joint thickness there is the fractional zoom,
  not the sprite.

**Its ranked nice-to-have, and what happened:**

1. *Thicken the base to 2 px* — the outer contour was 1 px, the same weight as an interior bed
   joint, so the wall had no line-weight hierarchy and did not sit on the floor. **Taken.** Paid for
   by taking the cap from 6 px to 5 rather than by robbing a course.
2. *Give the cap's lower edge more weight* — **not taken.** The cap is a 5 px solid band, already
   five times a bed joint; there is no pixel to find that would not come out of a course.
3. *Leave the ragged sides and the perfect regularity alone* — the sides were left alone. The
   regularity was not; see round 3.

## Round 2 — the base

Same reviewer, shown only the changed sheet, asked whether the change bought what it predicted and
whether losing a pixel off the cap cost anything.

**Verdict: ship it. Nothing must change.**

- **The hierarchy now exists and is legible: cap 5 > base 2 > bed joint 1.** Previously the base and
  the bed joints were both 1 px and indistinguishable, so the bottom edge was not readable as the
  outer contour. In a butted row the base now reads as a continuous ground line across the whole
  span — the gain shows up most where walls are actually used.
- **Losing a pixel off the cap cost nothing, and the reason is worth recording.** Total ink on the
  left/right silhouette is *unchanged* at 10 of 30 rows: it was 6 (cap) + 4 joint terminations, and
  is now 5 (cap) + 3 joints + 2 (base). The pixel was not spent, it was **relocated** from the top
  anchor to the bottom, where the rectangle was weakest. The cap still outweighs any joint 5:1 and
  is still the only full-bleed black mass, so the sprite stayed top-anchored.
- **No regressions.** Bake still contains exactly two values, 0 and 255 — zero anti-aliased pixels.
  Bond, phases and period untouched and re-audited from the bitmap. Columns 0 and 29 confirmed
  inked only on full-width rows. Six butted edge to edge: no seam, no stamp, one continuous wall.
- **Distinctness unchanged.** It noted the wall's identifying cue is being the only one of the three
  that is **full-bleed at both top and bottom**, which the heavier base reinforced.
- **Explicit warning: do not shave the cap further.** At 4 px it would come within striking distance
  of the base and flatten the hierarchy. Recorded so nobody reclaims that pixel later.

## Round 3 — putting a hand in it

A cross-cutting warning reached this sprite between rounds: exact regularity and uniform stroke
width are the tell-tale artefacts of generated imagery, and axis-aligned regular fields read as mesh
rather than material. The courses were made unequal (4/5/5/6, deepening toward the floor) and the
head joints were given alternating weight (1 px and 2 px). **It was also tried on the bed joints and
reverted** — they run the full width, so a 2 px bed reads as a second cap band across the middle and
competes with the real one.

Reviewed by a **fresh** reviewer rather than the one from rounds 1–2, because the question was now a
style judgement and the previous reviewer had already praised the even rhythm it was being asked to
re-examine.

**Verdict: nothing must change, and nothing is even worth acting on.**

- **Blind first impression at real size: "a brick wall."** Immediate, no second guess. Not a window,
  grid, waffle, barcode or crate. What kills all of those is the running bond — no vertical ever
  runs through more than one course, and a window or a grid needs continuous mullions.
- **The symmetry charge fails on measurement.** The sprite has **no axis of symmetry at all**: not
  mirrored (course 1's left stub is 2 px, its right stub 7 px) and not vertically symmetric (cap 5 vs
  base 2, courses 4/5/5/6).
- **The periodicity is real, and it is forced.** For the bond to run unbroken through a join the
  horizontal period must divide 30, which allows 10, 15 or 30. One hand-drawn quirk per box is a
  period of 30 — in a row of six that is **six identical "accidents" in a straight line**, a far
  louder machine tell than the regularity. There is no third option at this pitch, so the hand has
  to live in the vertical profile, and the reviewer judged that budget correctly spent.
- **Stroke taper is not available and should not be chased.** The minimum stroke is 1 CSS px; a
  taper would have to happen inside 2 device px, would be invisible at real size, and would put an
  odd-coordinate edge into a bake that is currently 100% even-aligned — trading dpr 1 crispness for
  nothing. The 1/2 px alternation between courses is the substitute.
- **Material, not mesh.** Perforation reads as perforation because its holes sit on a square
  lattice; the half-brick offset is what makes the eye read masonry instead. The solid cap anchors it
  as a built object rather than a swatch of pattern.
- **Artefacts: none.** Two tones only (0 and 255) at uniform alpha, and **every run boundary lands on
  an even device coordinate**, so it stays hard-edged at dpr 1 as well as dpr 2. Ink coverage 43.7%
  — the lightest of the three buildings, which is right, since a wall should recede next to a
  machine.
- **Tiling re-confirmed by rendering** 4-, 5- and 6-wide butted rows: the joint pitch divides the
  tile exactly, so a run is mathematically periodic at the brick pitch and the joins cannot be
  located by eye. The end stubs pair correctly across a join (7 + 2 and 1 + 7, each matching that
  course's interior brick).
- **An accident worth keeping.** In courses 2 and 4 the rightmost head joint stops 1 px short of the
  edge, so against the white floor it becomes a black edge tick. The right side therefore carries two
  edge ticks the left side does not — the reviewer called this "the single most *drawn* thing in the
  image", and it falls out of the tiling offset for free.
- **One measured oddity that is not a bug:** the wide head joints sit 0.5 CSS px right of a true
  half-bond (centre 8.0 where a perfect stagger wants 7.5). Even-coordinate placement offers only
  x = 12 or 14 device px and both miss by 1; it is forced by the crispness constraint and invisible.

## Distinguishable from the miner and the turret

Asked at every round, and answered by putting the three side by side at real size rather than by
argument. **No confusion with either, in any round.**

- **vs miner** — the miner is inset from its box and floats, with a hopper triangle and stack
  breaking its top edge and a bold ring low down. The wall has no curve anywhere, an unbroken flat
  top, and touches both side edges of its box.
- **vs turret** — the turret is a solid black dome on a centred vertical neck and plinth, and does
  not fill its box horizontally. The wall has no vertical axis, no curve and a flat top.

The wall is also the only one of the three with a **repeating interior field**; the other two are
single silhouettes with one or two interior marks. That classifies it at a glance, even out of
focus. Its identifying cue is being **full-bleed at both top and bottom**.

## Standing notes for whoever touches this next

- **Do not shave the cap below 5 px.** It would come within striking distance of the base and
  flatten the cap > base > joint hierarchy.
- **Do not ink the left and right box edges** to tidy the dashed silhouette. It puts a doubled
  vertical at every 30 px join, which is a worse artefact than a dashed edge, and both reviewers
  independently confirmed the trade is the right way round.
- **Do not add a hand-drawn quirk to the face.** Any variation across the box has a period of 30 and
  becomes a repeating stamp in a run.
- **Keep every edge on an integer.** It is what buys 0% anti-aliasing, and it is checked on every
  render by the harness's grey count.
