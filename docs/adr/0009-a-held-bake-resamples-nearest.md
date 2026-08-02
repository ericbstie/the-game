# ADR 0009 — A held bake resamples nearest

- **Status:** Accepted
- **Date:** 2026-08-02
- **Applies to:** `src/game/draw.ts` (the one `imageSmoothingEnabled` line), `src/sprite/cache.ts`
- **Decides:** the question
  [ADR 0008](0008-a-sprite-is-baked-at-the-scale-it-is-drawn-at.md) left open — "nearest against
  smoothed when magnifying" — which it said "returns for anything that ever does resample". The
  spread re-bake of [#92](https://github.com/ericbstie/the-game/issues/92) is that thing, and it is
  the only thing in the game that resamples a sprite.

## Context

ADR 0008 keys the bake on `dpr × zoom`, so a zoom that settles on a new scale makes every bake in
hand the wrong resolution. Paid whole that is **92–315 ms in one frame** — and not a rendering hitch:
it is spent inside the single `requestAnimationFrame` callback that also steps the avatar and judges
contact damage, on the thread that takes WebSocket delivery. A player who zooms out to survey an
incoming wave is the player most likely to be surrounded when it lands, and cannot move, fire or
receive for a third of a second.

`src/sprite/cache.ts` therefore spends a **fixed bake budget per frame** and hands back the bake it
already has for everything it has not reached yet. Those blits are the first in the game whose source
is not the size of their destination. Whether they should be filtered is the question below.

The two arguments were already measured, and they point opposite ways:

- **Sharpness.** ADR 0008's own table: with the filter off, a resampled blit is **2–4× further** from
  the picture it should be drawing (RMSE against a native bake at the destination size). Filtering is
  the best setting for every candidate that resamples.
- **Cost.** ADR 0008's blit probe: 1:1 is 3.9 µs, and a resample is 7–8 µs with the filter off
  against 17–21 µs with it on. **Per blit, the filter is the dearer half of resampling.**

What the frames of a settle change is *how many blits* that applies to: while the cache converges,
**every blit in the frame is a held one**.

## Decision

**`ctx.imageSmoothingEnabled` stays `false`.** A bake held over a settle is resampled nearest, and no
frame turns the filter on for it.

## What was measured

The worst frame, drawn through the shipped `drawWorld` from a cache warmed one wheel notch out so
that nothing in it is at the scale it is drawn at — every blit held, none re-baked — with the filter
off as shipped and then with it on, back to back in one session. dpr 2, `--enemies 500`, 800 × 600
CSS, headless Chromium under `--disable-gpu`. Single runs; read the ratios.

| | `0.5×` | `1×` | `3×` |
| --- | ---: | ---: | ---: |
| blits in the frame | 2,810 | 1,112 | 633 |
| converged — every bake at the scale it is drawn at | 21.15 ms | 14.28 ms | 31.08 ms |
| **converging, nearest (shipped)** | **22.23 ms** | **19.61 ms** | **41.52 ms** |
| converging, filtered | 32.08 ms | 37.43 ms | **158.29 ms** |
| what the filter adds, against the converged frame | +52% | +162% | **+409%** |

**At `3×` the filter costs more than the burst it is helping to hide.** The whole re-bake at `3×` is
92.34 ms paid in one frame; filtering the frames that replace it is **158 ms, every frame, for as
long as the convergence lasts**. That is not a trade between sharpness and speed, it is a refutation:
the treatment would cost more than the disease and go on costing it.

**It is worst exactly where the sharpness argument is strongest.** Magnification is where a filter
helps most and where it costs most — ADR 0008 measured 1:3 up at 7.1 µs nearest against 21.0 µs
filtered, and `3×` is the end of the range where every sprite magnifies. The two curves are the same
curve.

## Why the sharpness argument does not win anyway

**A held blit is a transient, and it is converging on the sharp bake.** The picture is whole from the
first frame after a settle — nothing is missing, only softer than it will be — and it is fully sharp
in about a second (`docs/frame-budget.md`). RMSE measures distance from an ideal that is arriving on
its own. Spending 40–400% of the frame to be closer to it for a second, on the one frame in the game
with the least room, buys the wrong thing.

**Filtering would also make the convergence *read* as two changes rather than one.** Nearest holds
the ink's edges and moves them; the filter softens them and then they snap hard again when the bake
lands. A picture that goes soft-then-crisp announces itself twice. This is a claim about how it
reads, not a measurement, and it is the weaker of the two reasons.

## Consequences

- **`draw.ts` keeps its `false` and gains a paragraph.** The line's comment said every blit is 1:1 so
  there is nothing for smoothing to interpolate. That is no longer true for the second after a
  settle, and the comment now says why the flag stays off through it anyway.
- **The blit stays cheap in the frame that most needs it to be.** Converging costs +5% at `0.5×`,
  +37% at `1×` and +34% at `3×` over the converged frame — the resample itself, which the length of a
  zoom gesture already pays today and always has (ADR 0008 §3).
- **Nothing else in the frame changes.** The one deliberate `imageSmoothingEnabled = true` in
  `drawWorld` — the tutorial's inline icons, which magnify a sprite into a line of text — is
  untouched and stays a local toggle. It is not a held bake; it is a permanent magnification, which
  is the case this ADR does not speak to.
- **This closes ADR 0008's open question for sprites and only for sprites.** Anything that later
  resamples *permanently* is a new question with a different answer available: the cost argument
  above is entirely about paying per blit on every blit at once.

## What this did not settle

- **Whether a player notices either way.** RMSE and milliseconds do not say what an eye prefers. The
  captures are the channel for that under ADR 0002, and the frame this decision governs is on screen
  for about a second at a time.
- **A GPU.** Everything here is software-rasterised under `--disable-gpu`, an upper bound. A GPU
  filters far more cheaply than a CPU does, so the margin above is the widest this decision will ever
  have — and the sharpness side does not depend on it, so a GPU could reopen this. What it cannot do
  is make the `3×` column safe on the machines this game is measured on.
- **Medians.** One run per column. The ratios reproduce the direction; the third decimal is noise.
