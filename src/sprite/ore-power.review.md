# ore-power — review

Advisory, per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md).
Four reviewer rounds, plus two drafts thrown out before a reviewer was worth calling.

## What it was looked at on

`ore-power.sheet.png` is the committed sheet, at the default dpr 2. Four other views were rendered
each round and thrown away, because a 15 px floor tile cannot be judged from a sheet alone:

- **The same sheet at `--dpr 1`.** 15 is one of the boxes where the fractional Windows ratio can
  misbehave, and dpr 1 is where the tile has the fewest pixels it will ever get. Every round was
  judged on dpr 1 first.
- **Tiled patches** — three accretion-grown patches, the shape `generateOre` actually makes rather
  than a rectangle, butted edge to edge on white paper, each tile's variant chosen by `drawWorld`'s
  own `tileVariant` hash, with a white plate the size of a generator dropped on one of them.
- **`sprite:frame`**, once the white-paper floor landed. This became the authoritative view: it is
  the only one that shows the ore beside metal ore and the grass, on the floor the game draws.

Every finding that mattered came from a patch or a frame, never from the tile. The scratch harness
that butts the patches is not committed — it is twenty lines over `scripts/headless.ts`.

## The two things four reviews kept coming back to

**1 · Red doing the filling is not a glow.** Every draft up to round 3 was a red lump with a black
line. Two reviewers independently reached the same verdict — swap the red for green and the drawing
loses nothing, because the red *was* the fill and there was nothing underneath for it to accent.
The drawing was inverted: the ore is solid ink, like every other sprite in this game, and the red
is only what escapes it. That is the arrangement where the red does drawing work rather than
category-label work, and it is the least red that can carry the grant.

**2 · A floor tile is judged as a field, never as a tile.** Three separate failures, each invisible
on the sheet and obvious the moment forty tiles were butted together: a tile-wide wash making the
patch a rectangle; then a halo whose ramp could not finish inside the box; then a lattice.

## Round by round

### Before a reviewer — two drafts thrown out

1. **A pale red wash over the whole box.** Butted into a patch it is a red slab with a hard
   rectangular edge. A uniform full-bleed tile has exactly the union of its tiles for an outline,
   which is a staircase of squares.
2. **Lumps placed by seeded jitter.** Every lump came out a circle — jitter of ±16% around a unit
   radius does not survive anti-aliasing at 30 device px, the trap `ore-metal.ts` names — and the
   patch read as confetti. Replaced by hand-cut lumps in twelve hand-placed fields.

### Round 1 — the arithmetic finding

**Every tile printed as a pale pink square.** `AURA_REACH` was a *multiple* of the piece's reach:
3 × a 4.3 px lump is a 25.8 px gradient inside a 15 px box, so the ramp could not finish and the
box chopped it while it still carried a fifth of its alpha. Measured: the 1 px border ring of nine
of twelve tiles carried mean red saturation 23–47; white paper was 0.0% of three variants; the seam
gradient spiked 1.9× at exactly one phase mod 15. The comment claimed the aura had faded by 62% of
its reach; the chop was at 26%. **Fixed:** the halo is an absolute 1.5 px past the piece, whatever
size the piece is, so the ramp always finishes inside the tile.

Also: the ink line existed on 22% of each outline at dpr 1 against 78% at dpr 2 — a stroke too thin
to exist, not anti-aliasing. 63% of marks carried no ink at all. Two byte-identical tiles landed
adjacent, and a run repeated at an offset of exactly 12, the variant count. Verdict on the three
questions: the glow did not read at 15 px, it was not distinct from metal ore desaturated ("metal
ore in a disabled state"), and the red was merely present and far too much.

### Round 2 — on the draft that darkened the body and added a hot core

"Reads as candy or a ladybird." A symmetric rounded shield with an off-centre bright patch is a
glossy bead. The hot core read as specular sheen, and at 15 px the four-value stack collapsed to
two anyway, so the fix never reached the player. The aura pooled into a rosy cloud covering more
area than the ink. **Fixed:** core gone; lump radii now swing 0.3–1.0 instead of 0.4–1.0, so the
bites survive both the rasteriser and the rim being grown over them.

### Round 3 — on the inverted drawing

Confirmed the inversion as the right call. Two faults: the rim was a **closed ring of even width**,
which is a rind and therefore decoration — nothing in it says which way the light is getting out —
and the patch was too sparse to read as ground. **Fixed:** the lean is now larger than the band, so
the rim closes off entirely on one flank and piles onto the other; and there is more stone per
tile, all of it ink, so the ore gained mass without spending any more of the colour grant.

### Round 4 — the first round judged on the real white floor

Everything before this was judged against M2's near-black placeholder, which inverts every
judgement about a glow. Two findings:

- **The patch was a hard axis-aligned rectangle.** All 48 variants reached all four box edges.
  **Fixed** without the neighbour mask #72 proposed: variants now vary which edges they reach —
  12 touch none, 12 touch one, 16 touch two, 8 touch three or four. The clamp that decides this
  measures the whole mark, stone *and* light *and* halo *and* longest ray; measuring the stone
  alone let the rays run off every edge, and the rectangle survived the first attempt at this.
- **Some variants ran close to half red.** A fixed rim width is a rim on a big stone and a coat of
  paint on a small one. **Fixed:** the rim is capped as a fraction of each stone.

Then the same round found that fix's own cost: **clamping every composition inward pulls all twelve
toward the middle**, and a patch of tiles whose mass is always central prints rows, columns and
even white gutters at exactly the 15 px pitch. Raggedness at the tile edge does not survive to the
patch if the mass never moves. **Fixed:** the clamp is gone, and each field anchors its mass at a
different, deliberately non-gridded position in its box, so two neighbouring tiles put their ore in
different corners — clumping across the seam in some places, leaving a gap in others.

## Open, and shipping anyway

- **Density is the next dial, and it has been turned down twice in a row.** Capping the rim and
  taking the mass off the tile centre both cost red, and on an ordinary monitor a patch on white
  paper is now noticeably quieter than the drafts that were called too loud. In a real frame it
  still reads — it is findable, unmistakably red, and no longer a rectangle — but it is closer to
  the sparse end than the loud end, and this is the first version of which that is true. If it
  reads thin in play, add stones rather than red: the ore is ink, and mass costs nothing from the
  colour grant.

- **The generator overlap is still not properly seen.** In the harness the plate only grazes a
  patch's corner, because a 5×5 plate is bigger than most power patches, and a reviewer called the
  composite closer to "a bite taken out of the ore" than "a plant standing on a seam". There is now
  ink in the field for the chassis contour to meet, and fields deliberately run stones off box
  edges so a half-covered ring shows light in the seam. Nobody has yet seen a plate centred on a
  patch in a real frame; worth one look when the two are next in the same picture.
- **Distinctness from the grass tufts is unverified.** Power ore, metal ore and grass are three ink
  textures on one floor. Against metal ore this is clearly distinct — angular crisp speckle against
  lobed stones with soft-edged light — and it should survive desaturation on silhouette alone. No
  reviewer has been able to compare it against grass at a size where the tufts are legible.
- **48 variants is twelve compositions in four orientations.** A reflection of scattered ground has
  no figure in it to come out backwards, but it is not the same as 48 drawings, and a reviewer
  looking for it can find it. `cache.wrap` makes more nearly free if a patch ever reads repetitive.
- **The harness reports 8% ink.** That reads low for an ink sprite and is meant to: it counts
  fully-opaque near-black only, so the red and the halo both land in its "grey" bucket. Judge
  panel 2.
- **Most bakes touch the edge of their box**, and the harness warns about it. For an upright sprite
  that warning means clipping; for a floor tile, a piece stopping short of every edge is a white
  gutter down every seam. What matters is that they do not *all* touch *all four*, which is the
  number that was measured and fixed.
