# ADR 0008 — A sprite is baked at the scale it is drawn at

- **Status:** Accepted
- **Date:** 2026-08-01
- **Applies to:** `src/sprite/cache.ts`, `src/game/draw.ts`, and every sprite blit once the camera
  can zoom
- **Decides:** the sharpness question [#92](https://github.com/ericbstie/the-game/issues/92) left
  open — the author took no stance between baking at reference scales, baking at max and
  downsampling, and accepting soft ink, and delegated the call to a `prototype`. This is that
  prototype's answer.
- **Extends:** the bake-at-`size × dpr` rule of
  [#77 §5](https://github.com/ericbstie/the-game/issues/77#issuecomment-5080621289)

## Context

The cache is keyed on `dpr` (`GameScreen.tsx:525`, `cache.ts:130`), and every blit is 1:1 — one
device pixel per baked pixel — which is what makes M5's ink crisp. A continuous zoom `z` breaks
that: the destination becomes `size × dpr × z` device pixels while the source stays `size × dpr`,
so the canvas resamples. Baking a key per `z` across a continuum is not possible, and M5 measured
full residency at **3.63 MiB at dpr 3** for a single key.

## Decision

**Key the bake on `dpr × z`, not on `dpr`.** The rule stays what it always was — a sprite is baked
at the scale it is drawn at, and blitted 1:1 — with `z` folded into that scale. One key is
resident, exactly as today, and the cache empties and re-bakes on a change to the product rather
than to `dpr` alone.

Three things follow, and each is a measurement below rather than a preference:

1. **`ctx.imageSmoothingEnabled = false` (`draw.ts:366`) stays false.** Nothing resamples, so the
   line stays true as written. Every other candidate would have had to flip it — with the filter
   off, resampling is 2–4× further from the ink it should be drawing.
2. **`snap()` must take `dpr × z`** (`draw.ts:1521`). This matters more than the bake strategy:
   a correctly-sized bake landed half a device pixel off loses more ink than any candidate's
   resampling does.
3. **The zoom must settle before the cache re-bakes.** Re-baking every frame of a zoom gesture is
   not affordable — the bill is below. Holding the previous bake and blitting resampled from it
   while the new one is made is the obvious way to hide it; that mitigation is not measured here.

## What was measured

A sprite baked through the shipped `bakeOne` at the shipped rule, blitted at nine values of `z`
across `0.5×`–`3×`, composited onto the white floor, and compared against a **native bake at the
same destination size** — the reference an unbounded cache would hand the blit, which is exactly
what a continuum cannot supply. Five sprites (`ore-metal` 15, `player` 28, `grunt` 32, `elite` 48,
`nest` 96), at dpr 1, 2 and 3, in headless Chromium under `--disable-gpu` through
`scripts/headless.ts`. Two numbers per cell:

- **Ink share** — `ink / (ink + grey)` on the composited result, the statistic `sprite:sheet`
  already prints. Higher is crisper.
- **RMSE** against the reference, in luminance 0–255. Lower is closer to ideal.

Both are needed and neither is sufficient: with the filter off, resampling *raises* ink share while
moving the drawing (aliasing keeps hard pixels and drops the right ones), which RMSE catches and
ink share does not.

### The candidates

| | bakes at |
| --- | --- |
| **accept soft ink** | `dpr` — today's cache, resampled by the canvas |
| **bake at max** | `dpr × 3` — one bake at the top, scaled down for everything below |
| **reference scales** | `dpr × {0.5, 1, 2}`, nearest in log space, resampled the rest of the way |
| **reference scales, upward** | `dpr × {0.75, 1.5, 3}`, always the next key **above** `z`, so the blit only ever minifies and never by more than 2:1 — added because the nearest rule above upsamples, and upsampling measured worse |
| **the bake follows the zoom** | `dpr × z` — the decision |

### Sharpness

RMSE against the native bake, mean of the five sprites, dpr 2, filter **on** (the best setting for
every candidate that resamples):

| z | accept soft | at max | ref {0.5,1,2} | ref up {0.75,1.5,3} | follows z | *½-pixel slip* |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 8.3 | 20.7 | **0.0** | 13.2 | **0.0** | 41.0 |
| 0.6 | 17.0 | 25.5 | 24.6 | 19.5 | **0.0** | 38.0 |
| 0.75 | 12.7 | 16.5 | 12.7 | **0.0** | **0.0** | 34.1 |
| 1 | **0.0** | 15.7 | **0.0** | 7.9 | **0.0** | 30.3 |
| 1.25 | 16.6 | 10.3 | 16.6 | 11.0 | **0.0** | 27.4 |
| 1.5 | 17.0 | 4.8 | 6.9 | **0.0** | **0.0** | 25.1 |
| 2 | 19.5 | 5.5 | **0.0** | 5.5 | **0.0** | 21.8 |
| 2.5 | 20.7 | 6.0 | 10.7 | 6.0 | **0.0** | 19.6 |
| 3 | 21.6 | **0.0** | 12.1 | **0.0** | **0.0** | 17.9 |

**"Goes soft" is a real number and it is worst where the ink is thinnest.** Accepting it costs
**a quarter of the solid ink at dpr 2** (67% ink share at `3×` against the reference's 92%) and
**almost half of it at dpr 1** (46% against 85%) — dpr 1 being the display the sprite README already
says to look at first.

**Baking at max fails at the bottom of the range, which is the opposite of what it was proposed
for.** Chromium's `drawImage` minification is a bilinear filter and not a mip chain, so a 6:1
reduction samples sparsely and aliases: at `0.5×` it reads **20.7** against the accept-soft
candidate's **8.3** over the same picture. A 2:1 reduction, by contrast, is very nearly free —
which is the whole reason the upward reference set exists.

**Nothing beats resampling by resampling less.** No key set removes the error, it only moves it to
where the keys are not: the upward set is exact at three points and 5.5–19.5 between them. Only a
bake at the destination size is zero everywhere, and it is zero by construction rather than by
tuning.

**The half-pixel column is the loudest thing on the page.** A bake that *is* the right size, landed
half a device pixel off, reads 17.9–41.0 — worse than every resampling candidate at every `z`, and
its ink share falls to 37% at `0.5×` where the reference is 63%. `snap()` is why that does not
happen today, and `snap()` divides by `dpr`.

### Memory

Exact arithmetic on the registry at 4 bytes a device pixel — the same basis as M5's figure, which
reproduces at **3.64 MiB** for the eight sprites that existed when it was taken. The eagerly-baked
set as it stands today is **4.96 MiB at dpr 3, 2.20 MiB at dpr 2**. Residency scales as the square
of the bake ratio, so a candidate's cost is a multiplier on whatever is resident:

| | factor | dpr 2 | dpr 3 |
| --- | ---: | ---: | ---: |
| accept soft | 1.00× | 2.20 MiB | 4.96 MiB |
| at max | 9.00× | 19.83 MiB | 44.63 MiB |
| ref {0.5, 1, 2} | 5.25× | 11.57 MiB | 26.03 MiB |
| ref up {0.75, 1.5, 3} | 11.81× | 26.03 MiB | 58.58 MiB |
| **follows z** | **0.25× at 0.5, 1× at 1, 9× at 3** | 0.55 → 19.83 MiB | 1.24 → 44.63 MiB |

**Nine times is the floor for anything sharp at `3×`**, because the top scale is squared and
dominates every set that contains it. Following the zoom reaches that floor only while the player
is actually at `3×`, and pays a quarter of today's bill at `0.5×`; baking at max pays it always.

**The ore settles it.** Both ore kinds bake lazily, one variant per distinct tile on screen, and
zooming out multiplies the tiles. At dpr 2, on the ore `frame:budget`'s worst frame carries:

| z | accept soft | at max | ref up | follows z |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 9.17 MiB | **82.56 MiB** | 5.39 MiB | 2.29 MiB |
| 1 | 2.29 MiB | **20.64 MiB** | 5.16 MiB | 2.29 MiB |
| 3 | 0.25 MiB | 2.29 MiB | 2.29 MiB | 2.29 MiB |

On a screen where every visible tile is a distinct variant — the ceiling the 2,304 declared variants
allow — baking at max holds **139–142 MiB** at `z ≤ 1`. That is not a trade, it is a refutation.

### Frame time

Medians of five runs, one container, dpr 2, `ENEMY_CAP` 500, an 800 × 600 CSS viewport, all figures
taken inside one browser launch so drift lands on all of them equally.

**A resampled blit costs two to five times a 1:1 blit, and the ratio does not matter.** 500 blits
into a fixed 64-device-px box, from sources of several sizes:

| source → destination | filter off | filter on |
| --- | ---: | ---: |
| 1:1 | **3.9 µs** | **3.9 µs** |
| 2:1 down | 8.2 µs | 17.4 µs |
| 6:1 down | 8.2 µs | 18.2 µs |
| 1:3 up | 7.1 µs | 21.0 µs |

**So the candidate that never resamples is also the cheapest one**, and by more than the sharpness
argument would suggest — the worst frame at `0.5×` carries 2,810 blits. The same worst frame, drawn
through the shipped `drawWorld` once per candidate:

| | z 0.5 (2,810 blits) | z 1 (1,112) | z 3 (286) |
| --- | ---: | ---: | ---: |
| accept soft | 18.08 ms | 10.80 ms | 11.28 ms |
| at max | 18.18 ms | 15.84 ms | 9.41 ms |
| ref up | 17.70 ms | 13.74 ms | 9.22 ms |
| **follows z** | **14.41 ms** | **10.79 ms** | **9.71 ms** |

**Zooming out costs 4 ms before any of this is decided.** The same frame, all sprites 1:1, at five
scales: **15.14 / 11.62 / 10.94 / 9.47 / 9.40 ms** at `0.5 / 0.75 / 1 / 1.5 / 3`. The floor is
what moves — a `0.5×` screen holds four times the ore tiles and about **868 grass tufts** against
217, which is past the ~300 crossover where a pattern or a chunk cache beats the per-tuft blit
(`frame-budget.md` rule 4). Zooming *in* is cheaper, because culling takes more away than the larger
blits add back.

**What following the zoom costs instead is a bake burst when the zoom settles.** The whole eager set
is 137 bakes at **10.6 ms** (and 25.3 ms at ratio 6); the ore is **~100 µs a tile**, so the worst
frame's ore is 35.2 ms at `1×` and **130.7 ms at `0.5×`**. That bill is lazy — it lands as the frame
asks for each bake — but the first frame after a settle asks for all of it. It is paid once per
settle against a resampling penalty paid every frame, and it is why the decision above says the
zoom must settle first.

## Consequences

- **`z` joins `dpr` in the bake's identity.** `SpriteCache.source` takes the product; nothing else
  about the cache changes, and the lazy-per-variant behaviour that makes the tiled ore affordable is
  untouched.
- **`snap()` and `BakedSprite.size` both divide by `dpr × z`.** They are the two places the 1:1
  guarantee is actually enforced, and both are wrong under a bare `dpr`.
- **A zoom gesture needs a settle before it re-bakes.** Without one the frame pays a 10–130 ms bake
  bill per frame of the gesture. What to draw in the meantime is the implementation's call.
- **`draw.ts:366` keeps its `false`, and keeps its comment.** The comment says the 1:1 geometry is
  what makes sprites crisp and that the flag is there so drift shows rather than being blurred into
  looking almost right. Under this decision that remains exactly true.
- **The frame budget gains a scale axis.** `frame:budget` measures one scale; the worst frame is now
  the widest one. `docs/frame-budget.md` is not amended here — the zoom does not exist yet — but the
  +4 ms at `0.5×` and the grass crossover are what #92's implementation has to spend against.

## What this did not settle

- **Whether a player notices.** RMSE and ink share say how far a treatment is from ideal, never
  whether anyone sees it. The captures the prototype wrote are the channel for that, reviewed blind
  under ADR 0002's discipline.
- **Nearest against smoothed when magnifying.** RMSE prefers the filter at every `z`; the filter is
  also what makes upscaled ink look soft rather than blocky, and a bold staircase may read better as
  1930s ink than a soft edge does. The decision above makes the question moot for sprites, and it
  returns for anything that ever does resample.
- **The mitigation.** Holding the previous bake and blitting resampled from it during a gesture was
  not built or measured — only the burst it would have to hide.
- **GPU compositing.** Everything is software-rasterised under `--disable-gpu`, an upper bound. A
  GPU resamples far more cheaply than a CPU does, so the frame-time margin above is the widest this
  decision will ever have. The sharpness and memory arguments do not depend on it; the frame-time
  one does.
- **Windows' fractional ratios under zoom.** dpr 1, 2 and 3 were measured. 1.25× and 1.5× — where
  `size × dpr` is already fractional and `bakedPixels` rounds — were not, and multiplying a
  fractional ratio by a continuous `z` is the one case this ADR has no number for.

The prototype's code was deleted, as the `prototype` skill asks. The instrument worth keeping is a
`zoom:ink` beside the other `*:ink` scripts, measuring the shipped path — which cannot be written
until there is a shipped path.
