# ore-metal — review

Metal ore, the 15 px ground tile, in pure ink. Three review rounds plus a judgement from #72's
floor agent against the finished white floor. The reviewer is advisory (ADR 0002 §3); what it asked
for is recorded whether or not it was taken, and the places where it was overruled say why.

## The instrument matters more than any single finding

**A 15 px tile judged alone tells you almost nothing.** Every real defect in this sprite was
invisible on the single-tile review sheet and obvious the moment real tiles were butted together.
So the loop here ran against a scratch harness — a `SpriteSubject` that lays a 7×7 block of real
tiles edge to edge and picks each one's variant with `drawOre`'s own `tileVariant` hash, so the
field on the sheet is the field in the game. Four versions died to it that the tile sheet passed.

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

**`facings: 96` — 24 drawings × 4 reflections.** `README.md` leaves the count to me. `drawOre` picks
a variant per tile coordinate and a patch runs to thirty-odd tiles, so 12 variants put four
pixel-identical copies of a field in one patch and two of them landed side by side. Reflections are
legitimate here in a way they are not for a character, because ground has no front. `cache.ts` wraps
`facing`, so the whole thing is one number, and 96 bakes of 30×30 is about 350 KB against a 3.63 MiB
budget for the entire set.

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

## Standing notes for whoever touches this next

- **Do not make the tile fill its box**, however tempting it is for seam continuity. A patch is a
  rectangle of tiles; if the tiles ink their own edges, the deposit is a rectangle. This was tried
  and reverted.
- **Do not add marks below ~9 px.** They come back as pepper at dpr 1, and they collide with grass.
- **Do not add a contour and a light body.** That is power ore's treatment, and the two ores have to
  differ by drawing.
- **Check edge crossings by clipped area, not by bounding box**, or hairline slivers land on seams.
- **Judge any change on a butted field at dpr 1 and in `sprite:frame`, never on the tile sheet.**

## #106 — bolder ink, and a thick border round the patch

The complaint was that ore and grass had become the same mark: small black scatter on white paper
at the same weight. The round-1 note above predicted exactly this and claimed three separators —
larger, solid, clustered. Measured, they were not enough. **A grass tuft carried more ink per unit
of its own box than an ore tile did** — 7.12% against 7.28% at dpr 1, and 12.69% against 10.98% at
dpr 2, where grass was the *heavier* of the two. Two marks of the same weight is the complaint,
stated as a number.

**The separation target picked here: an ore-metal tile carries at least 2× the ink per unit of its
box that a grass tuft does, at dpr 1, 2 and 3.** It is provisional (CLAUDE.md), and it is the ratio
rather than either figure because what the eye compares is one mark against the other. 2× is where
one is plainly the heavier without either changing kind. Measured after: **3.55× / 2.64× / 2.37×**.

### What changed here

**A stroke on every shard silhouette, `SHARD_WEIGHT = 1.1`.** Bolder was asked for as ink rather
than as size, so it goes on the outline of what was already hand-cut: each piece grows by half the
weight all round, thickening the blades and splinters that ghosted to grey at dpr 1, and not one
vertex of the twelve fields moved. `lineJoin` is round, because a mitre on a shard's apex draws a
whisker off the point.

**The fines take none of it.** A grain is a whole pixel on whole-pixel edges — the one mark at this
size with no anti-aliasing at all — and a stroke round a 1 px rect is a 2 px grey smudge. Stroking
them was tried in the head and rejected on that arithmetic; `paintCell` fills them and nothing else.

**The border is `tiled.ts`'s, not this file's**, because both ores need it and the neighbour
occupancy it turns on is already there. It is stroked from the **boundary sides only** — a tile with
ore on all four draws nothing — so a filled 3×3 patch carries one outline and not nine. That is the
easiest thing in this ticket to break and it is pinned by a test in `tiled.test.ts` that chains the
twelve stroked sides of a 3×3 into a single closed loop.

Two details of it worth carrying forward:

- **It is stroked with the tile's keep-region still clipped, at twice the weight it reads at.** The
  outer half is cut away, which lands the rim's outside edge exactly on the line the ink already
  stops at. So the rim cannot reach past where the patch ends, and the boundary stays as ragged as
  #87 left it — `ore:seams` boundary-edge ink went **down**, 0.009 → 0.004.
- **A boundary side's far corner is no longer jittered.** It was, and that stepped the rim at every
  seam along a patch edge: tile A ended its north side up to 1.65 px off the corner tile B started
  its own from. Only the interior samples jag now. This changes the *clip* too, and it is a small
  loss of raggedness — three jittered samples a side instead of four — bought for a rim that does
  not step.

### Measured

`bun run sprite:sheet`, over all 2,304 bakes. Two figures: the tool's headline (ink as a share of
covered pixels — a crispness reading) and ink as a share of the bake's whole box, which is the
density the eye compares between two marks.

| dpr | ink / covered | ink / box |
|---|---|---|
| 1 | 27.6% → **36.7%** | 7.28% → **18.41%** |
| 2 | 51.9% → **68.0%** | 10.98% → **29.76%** |
| 3 | 64.3% → **77.4%** | 12.44% → **31.93%** |

**The sheet weights all sixteen neighbour masks equally, which the floor does not** — most tiles in
a real patch are interior and carry no rim at all, so those figures overstate the border by a long
way. The floor number is `ore:seams`, which folds ink over **interior tiles only** and therefore
sees the shard stroke and nothing else: mean ink per device pixel **0.253 → 0.414** at dpr 1, a 1.64×
bolder interior.

**No slab.** The blackest single bake of the 2,304 at dpr 1 is **27.6% ink, 71.1% covered** — that
is the lone tile, rimmed on all four sides, which is the most border a tile can carry. Three
quarters of it is still paper.

`ore:seams`, dpr 1, over 63 interior tiles of real accretion patches:

| | before | after |
|---|---|---|
| seam fold deficit | 0.94× | 1.11× |
| boundary edge | 0.009 | 0.004 |
| interior edge | 0.263 | 0.381 |
| adjacent identical | 0 of 168 | 0 of 168 |

The fold moved from slightly seam-heavy to slightly centre-heavy and both are noise beside the 8.08×
this measurement was built to catch. The cause is the stroke: it adds ink round every shard, and
more shards sit in a cell's middle than across its seam.

### Known, and shipped anyway

- **The rim breaks at a concave corner of a patch, by about 2 px of tile.** Where two boundary sides
  approach a corner from perpendicular directions, the tile that owns the corner square has ore on
  all four sides and therefore draws no rim — and it cannot know otherwise, because the variant
  carries four bits of neighbour occupancy and no diagonal. The round caps close most of it; what is
  left is a slight rounding of the corner rather than a break, and the interior rubble is under it.
  **The fix is diagonal occupancy — a 256-mask instead of 16, 36,864 variants instead of 2,304** —
  which is its own change and was not made here.
- **`BORDER_WEIGHT = 1.9` and `SHARD_WEIGHT = 1.1` are provisional.** Neither has been played.
  Changing them is a retune.
- **Nothing here was reviewed by anybody but its author.** ADR 0002 §2 wants separate eyes and this
  note is not them. What was looked at: `bun run sprite:frame` at dpr 1 and 2, `ore:seams` at dpr 3
  as a magnified patch, and a hand-built shape harness — a solid 5×5, a ring with a one-tile hole,
  and a staircase — which is what the "one outline, not nine" test looks like as a picture.
