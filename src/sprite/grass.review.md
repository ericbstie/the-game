# grass — review

The ink tufts scattered on the white paper floor. 10 px box, 32 variants, `frames: 1`. The
reviewer is advisory (ADR 0002 §3); what it asked for is recorded whether or not it was taken, and
the places where it was overruled say why.

## The instrument matters more than any single finding

**A tuft judged alone tells you nothing, and neither does the review sheet's panel 2.** Panel 2
lays the variants out on a 10 px grid with even gaps, which is not a scatter — it is a specimen
tray. Every real defect in this sprite was invisible there and obvious the moment ~200 tufts fell
at the real density over a real floor.

No scratch harness was needed for that, and none was built. `sprite:frame` already renders the
shipped `drawWorld` over the shipped `grassAt` scatter, which means the field on screen *is* the
field in the game — real density, real hash, real per-tuft bake and clip, real white paper:

```sh
bun run sprite:frame --sprite grass=src/sprite/grass.ts --dpr 1 --at 20000,20000  # bare floor
bun run sprite:frame --sprite grass=src/sprite/grass.ts --dpr 1                   # and with ore
```

Two things worth knowing about it for whoever picks this up:

- **`--at 20000,20000` is the bare-floor view.** The demo camera sits on a scene full of
  buildings, spiders and ore; empty arena is where the scatter itself can be judged.
- **Run it at dpr 1, not just 2.** At dpr 1 the box is ten device pixels and there is nowhere to
  hide. Both versions that died here died at dpr 1 and looked acceptable at dpr 2.

## What was decided, and why

**`facings: 32` — 16 drawings × a horizontal mirror.** `README.md` leaves the count to me. Grass
is far more forgiving than ore here: tufts fall one per twelve tiles and never touch, so there is
no dense patch in which the eye can pair two copies up, and 32 puts ~6 instances of each drawing on
an 800 × 600 screen. Verified that all 32 actually reach the field — `grassAt`'s `variant` is
`jitter >>> 16` and the cache wraps it, so the count only works if the hash's bits are clean there:
over 29,889 tufts every one of the 32 appears, within ±7% of an even share.

**Mirrored across x only.** A y-flip would double the count for free and is what the ore agent
did, but ore is ground and has no up; every blade here grows from the foot, so a y-flip hangs the
tuft from its tips.

**Blades are filled, not stroked.** `ctx.stroke` cannot vary width along a path, and a constant
width at this size is the CAD-linework tell. Each blade is a quadratic spine sampled and offset by
a width running from a blunt root to a sharp tip, which is what buys the swell and the flick.

**All 32 bakes touch the bottom edge of their box, and that is correct.** The sprite is
foot-anchored: the bottom centre of the box is the point the game puts on the floor, so the roots
must reach it. Nothing touches the top edge.

**Ink is 43% of covered pixels at dpr 2 and 16% at dpr 1.** The dpr-1 figure is low and is the
real constraint on this sprite — see round 2. It is not a number to optimise: thresholding and
`putImageData` are both measured and rejected (#77 §4), and the harness counts white as grey so its
ink ratio reads backwards on white ground anyway.

**Cost is unchanged from #72's measurement.** Grass is ~0.45 ms of the frame at this density,
against the 0.8 ms the budget reserves — measured as the in-run delta between
`frame:budget --sprite grass=…` and `frame:budget` on the same machine, since absolute figures
drift by more than the layer costs. Nothing about the drawing can move that number: the geometry is
baked once per variant per DPR, and the frame pays ~200 `drawImage` calls of a 20 × 20 bake
whatever is inside them.

## #106 — 0.8×, so the tufts recede

#106's complaint is that ore and grass read as the same mark. The number behind it, measured on the
shipped sprites: **a tuft carried more ink per unit of its own box than an ore tile did** — 7.12%
against ore-metal's 7.28% at dpr 1, and 12.69% against 10.98% at dpr 2, where grass was the heavier
of the two. The three separators this file argues for above — open, oriented, sparse — are all real
and none of them is weight.

**The tufts go to 0.8×: an 8 px box, from a 10 px box.** Nothing else moved. Every blade in `TUFTS`
is still in the units it was hand-placed in — the module now names that box `DESIGN` and scales into
the smaller declared one — so the three-blade ceiling, the 2.6 px root spacing and the sixteen
compositions are all #72's, unchanged and unre-judged. `GRASS_PERIOD` stays 12; it was settled by
looking at a ladder of densities and this ticket did not ask about it.

**The cull already followed the sprite; the test is what #106 added.** `drawGrass` derived its walk
margin from the box the sprite source hands back *before* this ticket — `draw.ts:987`,
`Math.ceil(probe.size / TILE)` — so shrinking the box carried through with **no diff in `draw.ts`
at all**. What is new is the pin: `draw.test.ts` now reads the *tile* each tuft came from rather than
where its box landed, which is the version of that test that fails when the margin is hard-coded. The
first version did not: it read the blit's own left edge, which moves with the box and passed without
a walk existing.

### Measured — and this is the cost of receding

`bun run sprite:sheet`, all 32 bakes:

| dpr | ink / covered | ink / box |
|---|---|---|
| 1 | 19.4% → **13.0%** | 7.12% → **5.18%** |
| 2 | 46.3% → **38.0%** | 12.69% → **11.29%** |
| 3 | 59.2% → **52.0%** | 14.64% → **13.45%** |

Against ore-metal, ink per box goes from **1.02× / 0.87× / 0.85×** — grass as heavy as ore, or
heavier — to **0.28× / 0.38× / 0.42×**. #106's target was ore at 2× grass; it lands at 3.55× / 2.64×
/ 2.37×, and roughly half of that is this sprite giving ground.

**The dpr-1 ink share falling 19.4% → 13.0% is the honest cost and it is not a bug.** This file's own
round 2 fixed a floor of 1.8 px at the root, below which a blade has no near-black pixel at dpr 1 and
ghosts to grey; at 0.8× the thinnest blades sit at 1.52 px and are under it. That is what receding
looks like when the only tools are weight and size and the paper has no greys. **It was not
compensated for** — thickening the roots to hold the ink would fight the thing that was asked for.
If a played match says the tufts have gone too faint, the retune is the scale, not the blades.

**All 32 bakes still touch the bottom edge of their box**, which is the foot anchor and the check
that the tuft is scaled into the box rather than clipped by it.

**No slab, and never a risk here**: the blackest single bake at dpr 1 is facing 11, at 9.4% ink and
62.5% covered — and unlike the two ores, it is also the most-*covered* bake, so there is one tile
behind both figures rather than two.

**Cost is unchanged.** `frame:budget` on one machine, medians of seven runs each side: the whole
frame 8.19 ms → 8.03 ms, the grass-and-ore layer 1.18 ms → 1.18 ms. Nothing could have moved it —
the same ~200 `drawImage` calls, of a slightly smaller bake.

**Nothing here was reviewed by anybody but its author.** ADR 0002 §2 wants separate eyes and this
note is not them. What was looked at, per this file's own instruction: `sprite:frame --dpr 1` before
and after, and a magnified real patch with tufts scattered beside it — never the review sheet's
specimen tray.
