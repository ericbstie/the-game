# The frame budget

What one frame of the game is allowed to cost, and what it costs today. First measured in
[#72](https://github.com/ericbstie/the-game/issues/72) on a real canvas; re-measurable at any time
with `bun run frame:budget`.

The budget exists because Milestone 5 draws into this frame from several tickets at once, each
written by an agent who cannot see what the others are spending. Everything below is measured
**through the shipped `drawWorld`** rather than reserved beside it, so nothing here is an allowance:
the health bars and shot lines of [#74](https://github.com/ericbstie/the-game/issues/74),
[#99](https://github.com/ericbstie/the-game/issues/99)'s miner floats and
[#93](https://github.com/ericbstie/the-game/issues/93)'s minimap are all in the frame, drawn by the
code the game runs. The HUD is not in it and never will be — it is DOM and CSS beside the canvas
(`src/game/GameScreen.tsx:630`), so no canvas budget prices it.

## The number

**60 fps is a 16.67 ms frame. The worst frame the game can currently be asked to draw costs
6.3 ms — 38% of it, leaving 10.4 ms of headroom.**

That is the **median of eleven runs** on an idle machine: 6.27 ms, spread 6.09–7.76, mean 6.42. The
mean is the worse statistic here — one run of the eleven read 7.76 ms on its own and drags it — and
a run taken while the machine was under load read 6.83 ms and is not in the set at all.

The worst case is not hypothetical: 240 enemies (`ENEMY_CAP`, the hard governor), 40 structures,
6 players and 4 nests, *all inside the viewport so nothing is culled*, over the full grass-and-ore
floor, everything standing passing through the Y-sort — and every one of them damaged, so every one
of them carries a bar. The script reports it as **290 standing entities, 847 blits, 286 health bars,
61 shot lines, 10 miner floats**.

**61 is a count of stroked paths, not of shot lines.** Fifty are shot lines — 45 relayed squadmate
shots and 5 generated turret pulses, which is the `SHOT_LINES` the fixture asks for. The other
eleven are the minimap's marks: four nest rings, six squad dots and the self ring.

**The minimap is inside every figure on this page, the paper baseline included.** `drawWorld` draws
it whenever the frame's `selfId` names one of the players (`src/game/draw.ts:471`), and the fixture
puts six players in every world it measures, `p0` among them (`scripts/frame-budget.ts:171`). On the
full frame that is 68 fills, 21 arcs, 11 strokes and a rule, in the first row and in every row after
it. The total is honest; nothing attributes it. Isolating it would take a sixth measured layer with
`selfId` unset, and that delta would carry the self halo with it.

**The map's zoom level (#110) is below this instrument's resolution.** Eleven runs at each of the
three levels, one after another on one idle machine: **6.55 ms at 0.5×, 6.39 ms at 1×, 6.52 ms at 3×**
(medians; the thirty-three runs spread 6.08–7.51). The spread inside one level is several times the
gap between levels, so the three are one measurement and not three. The widest is the one to watch —
it walks 131 × 131 cells of the ore field where 1× walks 66 × 66 and 3× walks 23 × 23 — and it does
not show. Run any level with `--map`; the default is the level the map opens at, which is what every
figure above was measured at.

The fixture lays **the arena's own generated ore field** as well as the patches under the camera,
because the map's ore layer is bounded to the map's window rather than to the viewport: ore only
under the camera draws the same handful of marks at every level, and no level can then measure
dearer than another. It costs the floor two more visible tiles (845 → 847 blits) and puts **70
density cells** on the widest map against 27 at the other two.

## Measured under

- **Software rasterisation.** Headless Chromium with `--disable-gpu`, so every figure is an
  **upper bound** on what a player's GPU-composited browser pays. That is the honest direction to
  err in.
- **dpr 2**, an 800 × 600 CSS viewport — 1600 × 1200 device pixels.
- **A forced readback per iteration.** Canvas 2D defers rasterisation, so timing the draw calls
  alone measures queueing rather than painting. Each iteration ends in a 1 × 1 `getImageData` so
  the frame is actually painted before the clock stops.
- Run-to-run variance is roughly **±15%**, so **a single run is not a measurement**. Every figure
  here is a median over eleven runs on an idle machine. CPU contention inflates all of them, and a
  contended run has to be thrown out rather than averaged in. Treat these as the right order of
  magnitude, not as constants.

## Where it goes

Each row is the whole frame up to that point, which is what the script prints; **adds** is the
difference from the row above.

| Layer | ms | adds | What it is |
| --- | ---: | ---: | --- |
| Paper, grass, the squad and the map (`paper only`) | 1.7 | 1.7 | `clearRect` + the white `fillRect`, over 1.92 M device pixels, twice; 217 grass tufts; the 6 avatars with their names and bars; the 4 nests; the whole minimap |
| + ore (`+ grass and ore`) | 3.0 | 1.3 | 334 ore tiles, one blit each, and the 27 density cells the field puts on the map at 1× |
| + everything standing | 4.8 | 1.9 | 240 enemies and 40 structures join the sort: 285 more blits, 280 more health bars, 40 more marks on the map |
| + the shot lines | 6.3 | 1.4 | 50 concurrent — 5 generated turret pulses, 45 relayed squadmate shots |
| + the miner floats | 6.3 | ≈0 | 10 `+1`s, each stroked and filled — see below |
| **Total** | **6.3** | | **38% of a 16.67 ms frame** |

**The script's printed labels for the first two rows are wrong, and the names in brackets above are
what it prints.** `drawWorld` draws the grass unconditionally (`src/game/draw.ts:329`) while the
fixture's `withOre` flag controls only the ore, so "paper only" already carries the whole floor
cover and "+ grass and ore" is the ore alone. Drawn against an otherwise empty world, an 800 × 600
viewport takes 217 tufts.

**The small deltas do not survive the noise.** Each is a difference between two readings that each
vary by ±15%, and the floats row is the plain case: across eleven runs its delta came out *negative*
in five of them — the frame with ten `+1`s in it measured cheaper than the same frame without them.
Ten floats cost something; this instrument cannot see what. Read the cumulative column, and treat
any single delta under about 0.3 ms as zero.

The **Y-sort itself is not a cost**: 38.6 µs at 290 entities, 0.2% of the frame. [#71](https://github.com/ericbstie/the-game/issues/71)
measured the same sort at 36.6 µs for 250. Sorting is free; painting is not.

**The health bars are close to free, per bar.** The script prices them on their own: 60 cost
0.08 ms and 240 cost 0.32 ms, so a bar is ~1.3 µs — two axis-aligned fills on integer edges, and
those carry no anti-aliasing at all. The frame's 286 of them come to about 0.38 ms, some 2% of it.

**The hit flash is not a row of its own**, because it is not a layer: a flashing spider is one blit
of a cached variant instead of one blit of its ink bake, so the standing layer above already contains
it whether anything is flashing or not. It earned rule 6 by being measured the other way round first.

**The shot lines are not.** Fifty add 1.4 ms to the frame — better than a fifth of it for fifty
marks — which is what "the most expensive thing in the frame per unit" means in practice. Stroked on
their own the per-line cost is flat in the count: ~23 µs at ten, ~25 µs at fifty, ~26 µs at 150,
where 150 lines come to 3.8 ms. Flat per line is exactly why the 100 ms lifetime in `draw.ts`
(`SHOT_LINE_MS`) is a budget and not a look — nothing about drawing more of them gets cheaper, so
the count is the only lever. At 150 shot events a second it is what holds that count near 50
instead of near 150.

## The rules

1. **Shot lines are the most expensive thing in the frame, per unit** — and one effect has already
   beaten them, which is how the rule below got written. ~25 µs each: one costs about five sprite
   blits, because a stroked line across the viewport covers far more pixels than a 32 px sprite.
   (The standing row adds 1.9 ms for 285 blits and 280 bars, and the bars are 0.37 ms of it, so a
   blit is ~5 µs.) The **lifetime** is therefore the control, not the wire shape: at 150 shot events
   a second, a 1-frame line means ~3 on screen and a 1-second line means ~150, which is the
   difference between under 0.1 ms and 3.8 ms. **`SHOT_LINE_MS` is 100 and the budget is 50
   concurrent.** Above ~150 the frame stops being comfortable.
2. **Nothing new gets a full-viewport pass.** The clear and the paper fill are two of them already,
   1.92 M device pixels each. What one of them costs on its own is **not measured here**: the
   script's first row carries the grass, the squad, the nests and the map alongside them and cannot
   be broken down further. For the scale of a single full-screen pass, the grass table below —
   #72's, not re-measured — put full-viewport composites at 0.68–0.76 ms, and a vignette, a tint or
   a darkening overlay each buy one. The downed-player darkening (#81) is the one the spec asks for,
   and it is drawn (`src/game/draw.ts:477`); it is affordable precisely because only the dying
   player's own client draws it, and only while they are down. That also means the worst case above
   is **not** the worst case for a player who is dead — add a full-viewport fill to it, and they are
   looking at a screen with nothing happening on it.
3. **Cost stays independent of world size.** Every floor pass is bounded to visible tiles, and
   everything else is culled by the camera. A 31,200² arena costs what an 800 px one does. Anything
   added to the floor keeps that property.
4. **Scattered decoration is blitted per item, not filled as a pattern.** Below ~300 items a screen
   a per-item blit beats both a `CanvasPattern` and a chunk cache, because it touches only the
   pixels that carry ink while a full-screen fill touches all of them. Above ~300 the ranking
   flips. See the grass note below.
5. **Measure, do not reason.** Every number here contradicted at least one confident guess. The
   pattern fill was expected to be nearly free and is not; the per-tuft blit was expected to be the
   slow one and is the fastest; the Y-sort was the flagged risk and is 0.2% of the frame.
6. **A change to how a sprite looks is baked, not composited every frame.** A composite is billed
   per frame per unit and a bake is billed once, so the two are not close. The hit flash (#107)
   settled it with numbers: composited — the bake dilated out to a rim, punched back out of its own
   ink, paper filled in behind — it cost **~70 µs a flashing spider**, nine blits and two mode
   switches, *nearly three shot lines* and the dearest thing in the frame per unit. Derived once
   into a cached variant instead, it is **one blit, under 5 µs**, indistinguishable from drawing
   the spider at all. Sixteen simultaneous flashes went from ~1.1 ms to under the noise floor. What
   it costs instead is a **one-off ~310 µs (grunt) or ~380 µs (elite) per facing and frame**, one
   to two ordinary bakes, and only for the poses something is actually hit in — the same lazy
   bill the sprite cache already pays for the ink bakes, and it goes with the ratio the same way.

## How the grass mechanism was chosen

Three candidates, measured against each other at several densities. Net cost, after subtracting
the paper fill:

| Tufts on screen | Per-tuft `drawImage` | `CanvasPattern` | Baked chunks |
| ---: | ---: | ---: | ---: |
| 1135 | 2.65 ms | 0.76 ms | 0.82 ms |
| 587 | 1.31 ms | 0.69 ms | 0.80 ms |
| 284 | 0.63 ms | 0.70 ms | 0.84 ms |
| 201 | 0.45 ms | 0.68 ms | 0.77 ms |
| 151 | 0.32 ms | 0.70 ms | 0.81 ms |
| 71 | 0.17 ms | 0.76 ms | 0.81 ms |

The two full-screen mechanisms are **flat in density** — they composite every pixel of the
viewport whether or not there is ink in it — while per-tuft scales with the tuft count and crosses
below them at around 300 tufts a screen. The tile walk that finds the tufts is not the cost:
0.03 ms over 2,255 visible tiles.

**Per-tuft blits win**, and not only on the clock:

- **No cache, so no eviction policy** across a 2,080 × 2,080 tile world. That was the real design
  problem with chunks, and this mechanism simply does not have it.
- **No repeat.** A pattern tile large enough to hide its seam over a 31,200-unit floor costs 9–89 ms
  to bake and still repeats; the hash-derived scatter never does.
- **It re-uses the sprite cache unchanged.** The tuft variants are ordinary baked sprites, so they
  get the bake-at-`size × dpr` rule and the DPR re-bake for free.

## The density

**One tuft per 12 tiles — about 200 on an 800 × 600 screen, one per ~2,400 px² — in a 10 px box.**

Settled by rendering a ladder of densities at real size against the white floor and looking, which
is the only honest way to answer an art question with a performance consequence:

- At **one per 8** (~280 a screen) the scatter closes up into a continuous texture. It reads as a
  lawn, and it starts competing with the ink sprites standing on it — which is the exact failure
  the white floor was brought in to fix.
- At **one per 24** (~100) the floor opens into bare voids, most of a screen across, and the grass
  stops reading as a property of the ground.
- **One per 12** is the densest setting that still reads as marks on paper rather than as ground
  cover. It also holds at both extremes of the game: legible on an empty floor, and invisible under
  a 240-enemy wave, where the screen is saturated with ink regardless.

The **10 px box** is settled with it, because neither number means anything alone — the same
scatter reads as decoration at one size and as undergrowth at the next one up. Ten is the smallest
box whose blades still resolve on a non-retina display, and against the player's 28 px it stays
plainly something the player walks over rather than through.

Both are pinned by tests in `src/game/draw.test.ts`, so changing the hash or the period fails
loudly instead of quietly redressing the whole game.

## Re-measuring

```sh
bun run frame:budget                                     # the registry as it stands
bun run frame:budget --sprite grass=src/sprite/grass.ts  # layer in art that has not landed
bun run frame:budget --dpr 1                             # an ordinary, non-retina monitor
bun run frame:budget --map 15600                         # the corner map at its widest level
```

It prints the layer breakdown and the projected worst case, and writes the frame it measured to a
PNG so the numbers can be checked against the picture that produced them.
