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
