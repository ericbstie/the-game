# ore-power — review

Advisory, per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md).

## What it was looked at on

`ore-power.sheet.png` is the committed sheet, at the default dpr 2. Three other views were rendered
each round and thrown away, because a 15 px floor tile cannot be judged from a sheet alone:

- **The same sheet at `--dpr 1` and `--dpr 1.5`.** 15 is one of the boxes where the fractional
  Windows ratio can misbehave, and dpr 1 is where the tile has the fewest pixels it will ever get.
- **Tiled patches** — three accretion-grown patches, the shape `generateOre` actually makes rather
  than a rectangle, butted edge to edge on white paper, each tile's variant chosen by `drawWorld`'s
  own `tileVariant` coordinate hash, with a white plate the size of a generator dropped on one of
  them. Rendered at dpr 1, 1.5 and 2.
- **A real frame of the game**, via `sprite:frame`, for weight against the other sprites.

Every finding that mattered came from the patch, not from the tile. The scratch harness that butts
the patch is not committed — it is twenty lines over `scripts/headless.ts` and belongs to whoever
next needs it, not to this sprite.

## Rounds

### Before the reviewer: two drafts thrown out

1. **A pale red wash over the whole box.** Butted into a patch it is a red slab with a hard
   rectangular edge, and it made the ore the loudest thing on screen. A uniform full-bleed tile has
   exactly the union of its tiles for an outline, which is a staircase of squares.
2. **Lumps placed by seeded jitter.** Every lump came out a circle — jitter of ±16% around a unit
   radius does not survive anti-aliasing at 30 device px, the trap `ore-metal.ts` names — and the
   patch read as confetti with nothing beside the generator plate. Replaced by hand-cut lumps in
   twelve hand-placed fields.

### Reviewer, round 1 — measured, not impressionistic

The most useful finding was arithmetic rather than aesthetic.

**1 · Every tile printed as a pale pink square, and the patch was a visible mosaic.** `AURA_REACH`
was a *multiple* of the piece's reach: 3 × a 4.3 px lump is a 25.8 px gradient inside a 15 px box,
so the ramp could not finish and the box chopped it while it still carried a fifth of its alpha.
Measured: the 1 px border ring of nine of twelve tiles carried mean red saturation 23–47; white
paper was **0.0%** of three variants; the seam gradient spiked 1.9× at exactly one phase mod 15,
and 2.5× at retina. The comment claimed the aura had faded by 62% of its reach — the chop was
happening at 26%. **Fixed:** the halo is now an absolute 2 px past the piece's edge, whatever size
the piece is, so the ramp always finishes inside the tile.

**2 · The ink line existed only on retina.** `INK_BAND ± INK_LEAN` of 1.1 ± 0.5 *tile* px leaves a
0.6 device px flank at dpr 1. Measured: ink survived on 22% of each lump's outline at dpr 1 against
78% at dpr 2; two lumps had none at all; one whole variant had a single dark pixel. That is not
anti-aliasing, it is a stroke too thin to exist. What did survive read as a cast shadow on a tile
that must not imply light. **Fixed** by the redraw below — the band that leans is now the red rim,
at 1.6 ± 0.35, and the ink is the solid mass underneath.

**3 · 63% of the marks carried no ink at all**, ink was 13% of marked area against metal ore's
100%, and the bare marks read as spatter. **Fixed** by the redraw.

**4 · Two byte-identical tiles landed directly on top of each other**, and a three-tile run
repeated at an offset of exactly 12 — the variant count. **Fixed:** 48 variants, twelve hand-placed
fields in four orientations.

**5 · The generator plate punched a clean white hole** — "red crumbs swept out from under a white
coaster". Partly addressed: there is now dark structure in the field for the plate's contour to sit
against. Unresolved, see below.

**6 · The sparse variants punched holes at a regular period.** Softened by the move to 48.

Its verdict on the three questions: the glow did **not** read at 15 px ("you perceive a highlighted
grid cell, not light coming off ore"); it was **not** distinct from metal ore desaturated ("metal
ore at reduced opacity, i.e. the same material in a disabled state"); and the red was **merely
present and far too much** — "swap red for green and the drawing loses nothing, because the red
*is* the fill and there is no ink drawing underneath for it to accent."

It credited the lump silhouettes as genuinely lopsided rather than procedural.

### Reviewer, round 2 — on the version that answered round 1's loudness note

Run against a draft that had darkened the body and added a hot core.

**1 · "Reads as candy or a ladybird, not ore or ink."** A symmetric rounded shield with an
off-centre bright patch is the silhouette-plus-highlight of a glossy bead. **Fixed:** the lump
radii now swing 0.3–1.0 instead of 0.4–1.0, so the bites survive both the rasteriser and the rim
being grown over them.

**2 · The hot core read as specular sheen, not glow** — and **4 ·** at 15 px the four-value stack
(line, body, core, aura) collapsed to two anyway, so the fix it was meant to deliver never reached
the player. **Fixed:** the core is gone.

**3 · The aura pooled into a rosy cloud across the patch**, covering more area than the ink shapes
— the loudness problem relocated from the fill into the halo. **Fixed** with round 1's finding 1.

**5 · The patch read as debris spilled on the floor rather than a vein embedded in it.**
Partly addressed by the redraw: the mass is now ink, so it sits in the paper rather than on it.

It credited: organic patch boundaries, no 15 px lattice, no grid moiré, no dark seams at joins, no
implied external light source, and line weight that is not too thin to exist.

## What the reviews changed, in one line

**The ore became ink and the red became light.** Every draft up to that point was a red lump with a
black line; both reviewers independently reached the same verdict, that red doing the filling is
not a glow and leaves nothing for it to accent. The piece is now solid black — the way every other
sprite in this game is solid black — and the red is only what escapes it: a rim of light around the
stone, a few rays off it, and a tight halo. That is the least red that can carry the grant, and it
is the only arrangement where the red is doing drawing work rather than category-label work.

One thing found without a reviewer, from the miner agent's fifth round: drawing each piece's rim
and then its stone before starting the next lets the next rim cut into ink already laid down, and
two touching lumps end up with a red seam between them instead of merging. It is drawn in two
passes — every rim, then every stone.

## Open, and shipping anyway

- **The generator overlap is still not proven.** In the harness the plate only ever grazes a
  patch's corner, because a 5×5 plate is bigger than most power patches. The field now has ink for
  the chassis contour to meet, and several fields deliberately run a lump off a box edge so the
  half-covered ring shows light in the seam, but nobody has yet seen a plate centred on a patch in
  a real frame. Worth one look once the generator lands beside this.
- **The floor is still M2's near-black**, and on it this sprite is a different drawing. `sprite:frame`
  shows the ink stones disappearing into the dark ground, leaving the rims alone as red outlines —
  legible, and far quieter than the red-filled drafts were on the same floor, but not what was
  designed. Everything here was judged on the white paper #76 specifies, which is being built now.
  If the white floor arrives and the ore looks quiet, the rim is the dial — not the aura, which is
  what went wrong twice.
- **48 variants is a reflection trick.** Twelve compositions, four orientations. A reflection of
  scattered ground has no figure in it to come out backwards, but it is not the same as 48 drawings
  and a reviewer looking for it can find it.
- The harness reports **11% ink**. That number reads low for an ink sprite and is meant to: it
  counts fully-opaque near-black only, so the red and the halo both fall in its "grey" bucket.
  Judge panel 2.
- **All 48 bakes touch the edge of their box.** For an upright sprite that warning means clipping.
  For a floor tile it is the requirement — a piece stopping short of the edge is a white gutter
  down every seam in the patch.

## #106 — the rim, and a heavier crescent

#106 asks the ore for a thick border round the patch and bolder ink generally. Power ore was not the
sprite being confused with grass — red is its own separator — so it changes twice and modestly.

**The border comes from `tiled.ts` and is shared with `ore-metal`.** Stroked from the tile's
**boundary sides only**, so a tile with power ore on all four draws none and a filled patch carries
one outline rather than one box per tile; stroked under the tile's own keep-region at twice its read
weight, so the outer half is clipped and the rim's outside edge lands exactly where the ink already
stops. The geometry, and the one thing it does not handle, are written up in
[`ore-metal.review.md`](ore-metal.review.md).

It is **black**, like every other line in the game. The tile is now an ink boundary round a red
interior, which is the same grammar as a single body — an ink crescent round a red bead — one scale
up. That was not planned and is the best thing about it.

**`WEIGHT_MIN` 1 → 1.25 and `WEIGHT_OF_R` 0.42 → 0.55.** The crescent is where this sprite's ink
lives, so it is where the bolder ink goes. At dpr 1 the old floor put exactly one device pixel of
black on the smallest lit body, which is the width at which a line stops being distinguishable from
a grey edge. Both provisional.

**Not done: anything to the radiance, the ember or the fan.** The ask was ink. The aura is what went
wrong twice in the rounds above and it was left alone.

### Measured

`bun run sprite:sheet`, over all 2,304 bakes:

| dpr | ink / covered | ink / box |
|---|---|---|
| 1 | 2.2% → **18.9%** | 1.37% → **11.95%** |
| 2 | 4.7% → **29.2%** | 2.73% → **17.46%** |
| 3 | 6.0% → **33.0%** | 3.35% → **19.24%** |

Almost all of that is the rim, and the sheet weights all sixteen neighbour masks equally where a real
patch is mostly interior tiles — so it overstates it. The crescent's own contribution is what
`ore:seams` sees, folding over interior tiles only: mean ink per device pixel **0.307 → 0.318** at
dpr 1. Small, and meant to be.

**Still plainly a different tile from `ore-metal`**, by number as well as by colour: 11.95% ink per
box against metal's 18.41% at dpr 1, and 63.3% of the box covered against metal's 50.1% — this one
is the more *covered* tile and the less *inked* one, which is what a glow on paper should measure
like.

**No slab.** The blackest single bake of the 2,304 at dpr 1 is **21.3% ink**. Its 99.1% covered
figure is the radiance, which is translucent red over paper and falls in the harness's grey bucket —
read the ink column, not that one.

`ore:seams --kind power`, dpr 1, over 4 interior tiles: seam deficit 1.03 → **1.01**, boundary edge
0.017 → **0.014**, interior edge 0.257 → **0.325**, 0 of 27 adjacent pairs identical, unchanged.
Four interior tiles is a thin sample and always has been — power patches are ten to twenty tiles.

**Nothing here was reviewed by anybody but its author.** ADR 0002 §2 wants separate eyes and this
note is not them. What was looked at: a hand-built two-block shape at 10× with a concave corner in
it, and `sprite:frame` at dpr 1, 2 and 6 over the demo world's power patches.
