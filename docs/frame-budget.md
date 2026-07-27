# The frame budget

What one frame of the game is allowed to cost, and what it costs today. First measured in
[#72](https://github.com/ericbstie/the-game/issues/72) on a real canvas; re-measurable at any time
with `bun run frame:budget`.

The budget exists because Milestone 5 draws into this frame from several tickets at once, each
written by an agent who cannot see what the others are spending. The health bars and the shot lines
of [#74](https://github.com/ericbstie/the-game/issues/74) have landed and are measured below; the
restyled HUD has not, and is the last thing still owed a number.

## The number

**60 fps is a 16.67 ms frame. The worst frame the game can currently be asked to draw costs
6.2 ms — 37% of it, leaving 10.5 ms of headroom.**

The worst case is not hypothetical: 240 enemies (`ENEMY_CAP`, the hard governor), 40 structures,
6 players and 4 nests, *all inside the viewport so nothing is culled*, over the full grass-and-ore
floor, everything standing passing through the Y-sort — and every one of them damaged, so every one
of them carries a bar. 290 sorted entities, 845 blits, 286 health bars, 50 shot lines.

The in-world render layer is now complete, so this is measured **through the shipped `drawWorld`**
rather than reserved beside it. The health bars and shot lines below are no longer allowances: they
are in the frame, drawn by the code the game runs.

## Measured under

- **Software rasterisation.** Headless Chromium with `--disable-gpu`, so every figure is an
  **upper bound** on what a player's GPU-composited browser pays. That is the honest direction to
  err in.
- **dpr 2**, an 800 × 600 CSS viewport — 1600 × 1200 device pixels.
- **A forced readback per iteration.** Canvas 2D defers rasterisation, so timing the draw calls
  alone measures queueing rather than painting. Each iteration ends in a 1 × 1 `getImageData` so
  the frame is actually painted before the clock stops.
- Run-to-run variance is roughly **±15%**. Treat these as the right order of magnitude, not as
  constants.

## Where it goes

| Layer | ms | What it is |
| --- | ---: | --- |
| Paper | 1.9 | `clearRect` + the white `fillRect`, over 1.92 M device pixels, twice |
| Grass and ore | 0.8 | ~200 tuft blits at one per 12 tiles, and ~330 ore tiles |
| Everything standing | 2.2 | 290 entities: sort, cull, ~500 sprite blits and 286 health bars |
| Shot lines | 1.3 | 50 concurrent — 5 generated turret pulses, 45 relayed squadmate shots |
| **Total** | **6.2** | **37% of a 16.67 ms frame** |

The **Y-sort itself is not a cost**: 35 µs at 290 entities, 0.2% of the frame. [#71](https://github.com/ericbstie/the-game/issues/71)
measured the same sort at 36.6 µs for 250. Sorting is free; painting is not.

**The health bars are close to free.** Adding 286 of them moved the standing layer by roughly a
tenth of a millisecond, because each is two axis-aligned fills on integer edges and those carry no
anti-aliasing at all.

**The hit flash is not a row of its own**, because it is not a layer: a flashing spider is one blit
of a cached variant instead of one blit of its ink bake, so the standing layer above already contains
it whether anything is flashing or not. It earned rule 6 by being measured the other way round first.

**The shot lines are not.** Fifty cost 1.3 ms — a fifth of the whole frame for fifty marks — which
is what "the most expensive thing in the frame per unit" means in practice. A standalone stroke of
150 lines measures 4.2 ms on its own. That ratio is why the 100 ms lifetime in `draw.ts`
(`SHOT_LINE_MS`) is a budget and not a look: at 150 shot events a second it is what holds the
concurrent count near 50 instead of near 150.

## The rules

1. **Shot lines are the most expensive thing in the frame, per unit** — and one effect has already
   beaten them, which is how the rule below got written. ~26 µs each: one costs what a dozen sprite
   blits cost, because a stroked line across the viewport covers far more pixels than a 32 px
   sprite. The **lifetime** is therefore the control, not the wire shape: at 150 shot events a
   second, a 1-frame line means ~3 on screen and a 1-second line means ~150, which is the difference
   between 0.1 ms and 4.2 ms. **`SHOT_LINE_MS` is 100 and the budget is 50 concurrent.** Above ~150
   the frame stops being comfortable.
2. **Nothing new gets a full-viewport pass.** The paper fill is already the single most expensive
   item at 1.9 ms, because it touches every pixel. A second full-screen pass — a vignette, a tint,
   a darkening overlay for the downed player — costs about the same again. The downed-player
   darkening (#81) is the one such effect the spec asks for, and it is drawn; it is affordable
   precisely because only the dying player's own client draws it, and only while they are down.
   That also means the worst case above is **not** the worst case for a player who is dead — add
   about a paper fill to it, and they are looking at a screen with nothing happening on it.
3. **Cost stays independent of world size.** Every floor pass is bounded to visible tiles, and
   everything else is culled by the camera. A 31,200² arena costs what an 800 px one does. Anything
   added to the floor keeps that property.
4. **Scattered decoration is blitted per item, not filled as a pattern.** Below ~300 items a screen
   a per-item blit beats both a `CanvasPattern` and a chunk cache, because it touches only the
   pixels that carry ink while a full-screen fill touches all of them. Above ~300 the ranking
   flips. See the grass note below.
5. **Measure, do not reason.** Every number here contradicted at least one confident guess. The
   pattern fill was expected to be nearly free and is not; the per-tuft blit was expected to be the
   slow one and is the fastest; the Y-sort was the flagged risk and is 0.4% of the frame.
6. **A change to how a sprite looks is baked, not composited every frame.** A composite is billed
   per frame per unit and a bake is billed once, so the two are not close. The hit flash (#107)
   settled it with numbers: composited — the bake dilated out to a rim, punched back out of its own
   ink, paper filled in behind — it cost **~70 µs a flashing spider**, nine blits and two mode
   switches, *twice a shot line* and the dearest thing in the frame per unit. Derived once into a
   cached variant instead, it is **one blit, under 5 µs**, indistinguishable from drawing the spider
   at all. Sixteen simultaneous flashes went from ~1.1 ms to under the noise floor. What it costs
   instead is a **one-off ~310 µs (grunt) or ~380 µs (elite) per facing and frame**, about one to two
   ordinary bakes, and only for the poses something is actually hit in — the same lazy bill the
   sprite cache already pays for the ink bakes, and it goes with the ratio the same way.

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
```

It prints the layer breakdown and the projected worst case, and writes the frame it measured to a
PNG so the numbers can be checked against the picture that produced them.
