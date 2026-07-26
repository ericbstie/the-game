# ore-metal — review

Metal ore, the 15 px ground tile, in pure ink. Four review rounds plus a judgement from #72's floor
agent against the finished white floor. The reviewer is advisory (ADR 0002 §3); what it asked for is
recorded whether or not it was taken, and the places where it was overruled say why.

## The instrument matters more than any single finding

**A 15 px tile judged alone tells you almost nothing.** Every real defect in this sprite was
invisible on the single-tile review sheet and obvious the moment real tiles were butted together.
So the loop here ran against a scratch harness — a `SpriteSubject` that lays real tiles edge to
edge and indexes each one the way `drawOre` does, so the field on the sheet is the field in the
game. Five versions died to it that the tile sheet passed. A second harness grows real accretion
patches, because a patch boundary does not exist inside a solid block.

Two things it is worth knowing about that harness for whoever picks this up:

- **Run it at dpr 1 as well as 2.** The first version looked like angular rubble at dpr 2 and like
  uniform pepper at dpr 1, and dpr 1 is an ordinary monitor.
- **It has to replay the clip.** The game bakes each tile into its own 15×15 canvas, which clips
  it; drawing straight into a shared context does not. Without a `rect`+`clip` per tile the harness
  lies. That cost one wasted round.

`bun run sprite:frame` — the whole game in one frame — is the other half, and it is the only thing
that showed the patch-boundary defect below, because a patch boundary does not exist inside a 7×7
block of ore. **But do not judge a boundary from it without growing the patch yourself**: the demo
world paints rectangles and the shipping generator grows blobs. See round 3.

## What was decided, and why

**`facings: 144`, and the index is a coordinate rather than a hash.** This is the one thing here
that needed something outside the sprite, and it is the fix for the lattice — see round 4. `drawOre`
is asked to pass `(tx mod 12) * 12 + (ty mod 12)`. The sprite then knows its own cell on a 12×12
torus, derives its neighbours' cells by the same arithmetic, draws all nine and lets the box clip
them, so a flake that straddles a seam is drawn identically from both sides and is continuous.
`SpriteSubject` is unchanged: the index is still one number.

Twelve is chosen, not arbitrary: it is the smallest period past `METAL_PATCH_MAX` (80 tiles, ~11
across), so **no patch in the game can contain the same cell twice**, and two adjacent tiles can
never be identical. 144 bakes of 30×30 is 506 KB at dpr 2, against 3.63 MiB for the whole set.

**Solid black masses, no contour and no white highlight.** Both reviewers asked for an ink contour
around a lighter body. **Not taken.** At 9–12 px a contour heavy enough to read leaves an interior
of three or four pixels, and the fill it encloses would have to be white — which is the paper, so
the mass stops being a mass. The silhouette carries everything at this size. It is also the cue
that separates this from power ore, which *does* use a contour-and-body treatment (an ink crescent
around a red bead): the two ores must differ by drawing, not only by colour.

**No mark below about 9 px.** This is the single biggest change and it came from the pepper verdict.
Anything smaller has no straight run long enough to survive the rasteriser at dpr 1 and bakes into a
round grey smudge, and a fixed ration of small marks per tile is a tint rather than a material.

**Fractional DPR is expected to soften this, and is not a defect.** A 15 px box does not divide by
1.25 or 1.5, so at those ratios every edge resamples. #71's seam fix lands the *blit* on whole
device pixels; it cannot make 15 divide by 1.5. Checked at `--dpr 1.5`; recorded here so nobody
re-investigates it.

**`sprite:sheet` reports 16 bakes that drew nothing and 56 that touch the edge of their box. Both
are correct.** Four of the 24 fields are bare paper on purpose, and ten reach an edge on purpose.

## Round 1 — two reviewers, and they agreed

Two independent reviewers were run on the same images. They reached the same four findings with
independent measurements, which is worth more than either report on its own.

**Verdict: rejected.**

1. **A white lattice on the seams, measured.** Every 15th row and column carried near-zero ink — a
   20:1 gutter against a tile centre — because every mark was composed inside its box and nothing
   ever crossed a join. Visible as a plaid at squint distance.
2. **Pepper, not mineral.** Both used the words independently: *pepper*, *flyspecks*, *halftone*,
   *dot screen*. About 60% of the marks were 1–2 px grains, and on white paper a lone black pixel is
   a flyspeck.
3. **A constant recipe per tile.** Every tile carried the same grade and roughly the same mass, so
   the density never changed and the field read as a screen tone however well the pieces were drawn.
4. **Exact rectangles and exact 45° diamonds are the CAD tell.** The whole-pixel grains were perfect
   rectangles, and some rotations put shard edges exactly on an axis or exactly on 45°.

**What was done:** every grain deleted; marks raised to 5–10 px and later to 9–12; mass varied 0–3
per tile with genuinely empty tiles; overlapping pairs that fuse into one broken lump; variants
24 → 96; and no placement left on a quarter- or eighth-turn.

The lattice was first fixed by making each tile a **torus** — drawing every mark nine times so what
runs off one edge reappears on the opposite one. That killed the gutter and was then **reverted**;
see below. Worth recording why, because it looks like the obvious fix: a torus-wrapped tile
necessarily inks all four of its edges, and a patch of tiles that all ink their edges ends in a
perfect rectangle.

## Round 2 — a self-caught defect, and a measurement worth keeping

Round 2 caught nothing the author had not, because rendering the field turned up a defect first:
faint grey hairlines lying exactly along tile seams. These are **marginal edge crossings** — a mark
whose sharp corner pokes a fraction of a pixel past the box edge bakes a sliver too thin to exist,
and it lands precisely where a seam lattice would be.

A bounding-box overshoot test **misses these**, because an acute vertex can reach well past the edge
while the shape crossing it is still a sliver. The check that works clips each polygon against each
edge and measures the **area** that lands outside: it must be either zero or at least ~2 px². That
is a scratch script, not shipped, but the rule is worth writing down. Twelve crossings were found
and nudged; the sprite currently has none.

The hairlines that survived that fix turned out to be the harness's own `clip()` anti-aliasing, not
the sprite — the single-tile bakes were clean. That is the "replay the clip" note above.

## Round 3 — the floor turned white, and #72 judged it in a real frame

The floor was dark for the first two rounds. When it became white paper, #72's agent looked at the
ore in a real frame and reported three things. All three were taken.

1. **A patch read as a hard-edged axis-aligned rectangle — a highlighter swipe, not a deposit.**
   This is the torus wrap's fault, and it is why the wrap was reverted. The fix is the cheap one: do
   not fill the box. Most fields now sit inside an irregular margin and only ten of 24 cross an edge
   at all, on varied sides, so a patch boundary comes out ragged for free and the interior gaps read
   as sparseness. #72 proposed extending the sprite contract with a neighbour mask instead; that was
   declined, and no contract change was needed.

   **A correction worth carrying forward: the rectangle was partly the fixture.** `demoOre` in
   `scripts/demo-world.ts` paints patches with a `paint(fromTx, toTx, fromTy, toTy)` helper, so
   every patch in `sprite:frame` is a rectangle. The shipping generator does not — `generateOre`
   grows patches by **accretion** from a seed tile, so a real patch is a blob. That does not make
   the finding wrong, it makes it worse: a full-bleed tile on a *diagonal* boundary prints a
   staircase of squares, which is what `ore-power` independently hit and threw out in its first
   draft. The margins fix both shapes. Judged on a scratch harness that grows real accretion
   patches and lays real tiles into them, rather than on the rectangular fixture.
2. **Still pepper.** Superseded by the round-1 work, which had already deleted every small mark.
3. **New, and it only exists because the floor turned white: the ore and the grass tufts became the
   same visual language** — both small black marks on paper, at comparable scale (grass is one tuft
   per twelve tiles in a 10 px box). They are separated here by three things at once: ore marks are
   **larger** (9–12 px against a 10 px box holding a few thin strokes), **solid** rather than open,
   and **clustered** — ore comes one to three per tile with pairs fused into aggregates, where grass
   comes one per twelve tiles and never touches another tuft.

The margins are deliberately **unequal on the four sides of each field**. A constant inset would put
the round-1 gutter straight back.

## Round 4 — reject, on five measurements, and the one that needed help

The strongest review of the four, and the only one that measured the bitmap rather than describing
it. It **passed** the ragged accretion outline (no straight runs, no right-angled steps, no square
staircase in any silhouette — "night and day" against power ore's rectangle), found no seam
hairlines and zero orphan grey pixels at either dpr, and confirmed nothing collapses at dpr 1.
Then it rejected the sprite on five counts.

**1 · The 15 px lattice was still there, and it was not a margin problem.** Folding ink density
modulo 15 across four real blocks gave a **4–7× deficit sitting exactly on every seam** — at dpr 1,
columns 27.9 in the centre against 7.5 at the edge, rows 29.5 against 5.0. Not one flake crossed a
join. Sparse patches masked it; dense ones made the flakes fall into visible rows.

This is the finding that margins cannot fix, and it is worth being precise about why the earlier
reasoning was wrong. Round 3 replaced the torus wrap with irregular margins to get a ragged patch
edge. That was right for the boundary and **wrong for the interior**: a margin puts *less* ink on
the seam, which is the defect. Ink has to actually cross the join, and a tile that knows only its
own hashed variant cannot put it there, because the neighbour has no way to agree about it.

The fix is the coordinate index above, and it dissolves the trade that had been fought over for
three rounds — flakes cross seams *and* the patch edge stays ragged, because a cell that happens to
be sparse still leaves its own edges bare.

**2 · Density was binary, not real.** 98 measured cells were either 17–28% covered or exactly 0,
with three exceptions: no gradient anywhere, so a patch had no body and no fringe. Its edge was a
*stencil* edge rather than a thinning one, and empty interior cells read as punched holes — it
found an L-shaped white hole with right-angled corners mid-patch. **Taken:** twenty-two cell
recipes now run continuously from about 2% to 30%, and there are no empty cells at all, because a
cell's neighbours now bleed into it.

**3 · It read as CAD.** 98% of 285 components had convex-hull solidity ≥ 0.95, median ≈ 1.0 — every
silhouette a convex straight-edged polygon, no re-entrant corners, no notches. Beside the egg sac's
bold contours the reviewer said the two "share no drawing language at all". Blind first impression:
*"coarse cracked black pepper shaken onto paper."* **Taken:** every mass and chip is re-cut with
two or three bites back to about half the peak radius; measured median solidity is now 0.86 and the
only convex outlines left are the 2 px specks, which have no room for a notch.

**4 · Adjacent identical tiles**, in an L at (4,5), (4,6) and (5,5) of one block, and two more
pairs. **Taken**, and now impossible: adjacent tiles have different cells by construction.

**5 · Lone fringe flakes were the one real grass ambiguity.** Fill-versus-line is a strong
separator, but size is not — median flake bounding box was 6×6 px against a 10 px tuft, only 1.6×.
**Taken:** every cell carries at least two marks.

**6 ·** Two 1-px pinholes fully enclosed by ink, from a sliver between near-coincident polygons.
**Taken:** overlapping pairs are now checked from the geometry to overlap deeply rather than graze.

### One instruction from the reviewer that was tried and reversed

It asked for **contour wobble** — subdivide each edge and jitter the midpoint. Tried, and it made
things worse: at r = 4.6 a few hundredths of a unit is a quarter of a pixel, which cannot be drawn,
so it only blurred the corners and at dpr 1 the masses came out as featureless blobs. The
irregularity now lives in the corners instead, displaced far enough to survive a pixel. This is the
same lesson as the specks: **at 15 px, a mark you cannot draw is worse than no mark**, because it
spends contrast and returns mush.

### And one the reviewer's own hint corrected

It noted dpr 1 rounds the corners off so flakes read as pebbles, while dpr 2 keeps them faceted, and
judged **dpr 1 closer to the intended style**. That is a clue about geometry, not the rasteriser:
long straight runs between few, far-apart corners are what survive at dpr 1. Vertex counts were cut
back accordingly — masses went from 15–17 corners to 9–11.

### Still open

Marks are spread right across their cell and are meant to hang over its edges. An early cut of this
round kept them near cell centres, which put one clump per tile and reinstated the 15 px rhythm in a
new form — the torus fixes seam *continuity*, not composition. Worth watching if anyone re-places
these.

## Standing notes for whoever touches this next

- **The variant index must stay a coordinate.** If `drawOre` ever goes back to hashing, the seam
  lattice comes straight back and no amount of drawing fixes it — a tile cannot agree with a
  neighbour it cannot identify.
- **Do not solve the seam by making tiles full-bleed.** That was tried, as a torus wrap inside a
  single tile. It kills the gutter and forces every tile to ink all four edges, which makes a patch
  end in a hard outline. The coordinate index gives both.
- **Do not place marks near cell centres.** A cell is exactly a tile, so centred marks put one clump
  per tile and the 15 px rhythm returns even with seams joined.
- **Keep the specks a garnish.** Marks below ~4 px were the bulk once and two reviewers called it
  pepper; they are now about one per cell and they are the only convex outlines in the set.
- **Do not add detail below a pixel.** Contour wobble at a quarter of a pixel blurred the corners
  and bought nothing. Irregularity has to be at least a whole pixel to exist.
- **Do not add a contour and a light body.** That is power ore's treatment, and the two ores have to
  differ by drawing.
- **Check edge crossings by clipped area, not by bounding box**, or hairline slivers land on seams.
- **Judge any change on a butted field at dpr 1 and in `sprite:frame`, never on the tile sheet.**
