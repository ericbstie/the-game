# `lettering` — the producing agent's notes

The sprite: the hand-lettered sound effect struck where a shot connects and where an enemy dies
([#79](https://github.com/ericbstie/the-game/issues/79)). One variant per word, four words,
`POW` · `ZAP` · `BAM` · `BOP`, in a 36 unit box.

**An independent visual review is owed on this sprite and has not happened.** ADR 0002 §2 requires
one and it is dispatched separately from the work that produced the art. Everything below is the
producing agent's own account — what was built, what was measured, and what was built and thrown
away. Nothing in it is a second opinion, and it should not be read as one. The precedent that makes
saying so worth the space is [#120](https://github.com/ericbstie/the-game/issues/120), whose gun icon
shipped self-reviewed and whose central claim the later independent pass found measurably false at
the real blit size.

**One sprite, four variants, one agent** — which is ADR 0002 §1 read as it is written. The words are
the `facing` axis, the way the egg sac's two states and the room's five edges are, so consistency
*between* the words is one agent's responsibility rather than four agents' coincidence. A reviewer
therefore has four bakes to compare on one sheet, which is the arrangement the sheet exists for.

## What it is

| | |
| --- | --- |
| Box | **36** — derived; see below |
| Facings | 4, one per word |
| Frames | 1 |
| Colours | ink `#000` and paper `#fff`, and nothing else (pinned by a test) |
| Sheets | `lettering.sheet.png` at dpr 2 (committed) |

Three elements, in the order they are struck:

1. **Sixteen bearings**, each carrying a ray where the word leaves room for one — stroked ink at 1.7
   units, from just clear of the lettering out to the edge of the box, alternating long and short,
   every reach jittered. Bearings where the word already fills the box get nothing, so the burst reads
   above and below the lettering and not along it.
2. **The word's paper** — every letter stroked in white at `STROKE + 2 × HALO`, the whole word before
   any of its ink.
3. **The word's ink** — the same layout stroked in black at 2.4.

Each letter is a run of stroked paths in a unit box, smoothed through the midpoints between its
points so a short list of hand-placed points comes out as one continuous curve. Seven letterforms
cover all four words, which is half of why the set is the set.

## The box is 36 because of the health bar

The only number here that is not a look. A word is blitted **centred on the mark**, so it reaches
`SIZE / 2` above the blow. A damaged spider carries the game's one damage readout directly above its
sprite (#81): for a grunt that is `BAR_GAP` 3 + `BAR_HEIGHT` 4 above a 32 unit box, so the bar's
underside sits **19 units** above the mark. At 36 the box stops a unit short of it.

#115 hit the same wall and answered it differently — its long spikes are the diagonal ones, so a
spike is clear of the bar's *width* before it is above the bar's underside. A blitted box has no
diagonal to hide in, so the box itself is what has to clear the bar. `draw.test.ts` asserts it off a
rendered frame — the bar's own `fillRect` against the word's own `drawImage` — rather than off the
constants, so a retune of either one fails loudly.

Two consequences worth knowing:

- **36 is just inside `PUFF_REACH` (19).** #116's cloud runs at 14 to 19 from the mark and the word's
  paper stops at 16.6 across and 9.4 up, so a lettered death reads as a word *inside* a cloud rather
  than as a word that ate one. `bun run sprite:frame` is the instrument that shows it — its demo world
  puts two lettered deaths and two lettered hits in one frame.
- **36 × dpr is a whole number at 1, 2, 3 and at Windows' 1.25 and 1.5**, so the blit is 1:1 at every
  ratio a player is likely to have and `BakedSprite.size` never has to correct the box (#77 §5).

## The starburst: five bakes were built and rejected before this one

**This is the part of the sprite that was arrived at by measuring rather than by drawing**, and the
reason is arithmetic the ticket could not have known: a field wide enough to hold three legible
letters is 33 units across, which in a 36 box leaves a star nothing to be.

The word's paper reaches **16.6 units** at the height it is lettered on. Any 12-point star that fits
the box has its valleys at about **9**. So the word's paper always crosses the star's outline,
whatever order the two are struck in — and every failure below is that one fact wearing a different
hat.

| # | Bake | What happened | Why it was dropped |
| --- | --- | --- | --- |
| 1 | 12-point star under the word, a point on the horizontal axis | The east and west points were cut off their own bodies by the word's paper. Two black ticks floating beside the word | An impact mark cannot afford detached debris; ink 1042/grey 1702 at dpr 2 |
| 2 | The same, star rotated half a step so valleys sit on the axis | The damage moved rather than going: four points near the horizontal severed instead of two | Same failure, more of it |
| 3 | The word's paper laid *under* the star, so the outline survives | The star's points landed across the letters. `POW` read `POИ` | Legibility. The whole ticket is a legible word |
| 4 | No paper at all, letters struck straight onto the star | The outer letters merged into the star's ink — the same failure as 3 without the separation that made it visible | Legibility, and it also gave up the one thing the paper is for |
| 5 | Rays outside the word's paper, **tapered and filled** | Read as four detached wedges per corner — debris, not a burst | A star's point reads as a point because it stands on a body; this mark's body is the lettering, and there is none to spare |
| **6** | **Rays outside the word's paper, stroked at even width** | **This one** | — |

The mechanism that made 6 possible is `lettered(bearing)` — how far the word's paper reaches along
one bearing, as a ray against the lettering's own rectangle. Every ray starts from that plus
`SPIKE_GAP`, so **nothing is ever drawn across anything** and no ordering can sever a mark. It is
derived from the layout rather than measured off the glyphs, so a retune of the letter size or the
halo moves the rays with it instead of leaving them overlapping the word.

**The honest cost of 6 is that the mark is a word with rays rather than a word on a field.** The
ticket asks for "on a starburst"; what it got is a starburst *around* rather than *under*. A reviewer
should say whether that reads as the era or as emphasis lines. In the game it is the milder question
it looks: a lettered hit always has #115's burst under it and a lettered death always has #116's
cloud, because the word rides exactly those marks — so the field the ticket asked for is there, drawn
by the layer that was already drawing it. Which raises the honest converse, and it is in the report
to the author rather than settled here: **this sprite's own rays are close to redundant on both
events.**

## Two more things that were built and dropped

**Tapered rays** — covered above, and the numbers are that the tapered bake read 731–881 ink at dpr 2
against this one's 793–943, so it was also *lighter*: a triangle standing free is mostly its own
point.

**A paper plate behind the lettering, star-shaped or rounded.** Not built as a bake, because the
arithmetic rules it out before a picture is needed: to contain the word's paper the plate must be at
least 16.6 × 9.4, and a 33 × 19 opaque field centred on a blow covers about 60% of a grunt. #115
chose spikes with an open middle *specifically* so the mark would not hide the spider #107 has just
flashed white, and a plate would have given that back. What the game has instead is paper carried
per letter, which covers only the letterforms.

## Measured

### The bakes, from `bun run sprite:sheet`

dpr 2, the committed sheet:

| Facing | Word | Ink | Grey | Covers |
| ---: | --- | ---: | ---: | --- |
| 0 | POW | 808 | 1177 | 64 × 67 at 4,2 |
| 1 | ZAP | 793 | 1148 | 62 × 66 at 4,3 |
| 2 | BAM | 943 | 1234 | 64 × 69 at 5,2 |
| 3 | BOP | 814 | 1102 | 61 × 69 at 4,2 |

Ink is **42%** of covered pixels across all bakes. dpr 1, the resolution that matters most:

| Facing | Word | Ink | Grey | Covers |
| ---: | --- | ---: | ---: | --- |
| 0 | POW | 155 | 401 | 32 × 34 at 2,1 |
| 1 | ZAP | 146 | 417 | 31 × 34 at 2,1 |
| 2 | BAM | 179 | 444 | 33 × 35 at 2,1 |
| 3 | BOP | 148 | 392 | 31 × 35 at 2,1 |

**28% at dpr 1, and it is not being "fixed".** The letterforms are curves and the rays are diagonals,
so most device pixels a word touches are partial ones. Every fix that suggests itself has been
measured and rejected already (#77 §4, `README.md`): thresholding shatters the curves, per-pixel
testing goes polygonal, and the AA flags are no-ops. `POW`, `ZAP`, `BAM` and `BOP` are all readable at
dpr 1 in panel 2 of the dpr 1 sheet, which is the only panel that shows what a player sees. The `O`'s
counter is a two-pixel slit there and is the first thing a reviewer should look at.

**`BAM` is the heaviest bake at both densities** — 943 against 793 at dpr 2, 18% more ink than `ZAP`.
Three letters with no counter and two of them made of diagonals. If one word ever reads too heavy
beside the others it is this one.

**Two bakes touch the edge of their box, and the sheet says so.** That is deliberate: `SPIKE_REACH` is
`CENTRE - SPIKE_WIDTH / 2`, so the longest ray's round cap lands exactly on the box's edge and uses
every unit the health bar leaves. The first bake of this treatment did not derive it and ran 0.25
units *outside*, which the same warning caught.

### The ink, from `bun run lettering:ink`

Committed as an instrument, not quoted from a run: `scripts/lettering-ink.ts`. It blits through the
shipped sprite cache rather than redrawing the sprite, which is #120's lesson as code — a bake
measured in its own box is only what the player sees when the box and the blit agree, so the probe
takes the box off `BakedSprite.size` instead of assuming 36.

| dpr | Word ink (device px) | Heaviest | Against a shot's mark | Solid share | Box |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 262 | 294 | 19.2% | 32.0% | 36 |
| 2 | 1,056 | 1,175 | 19.3% | 61.5% | 72 |
| 3 | 2,394 | 2,664 | 19.4% | 72.4% | 108 |

A word lays about what #115's burst does (18%) and #116's puff does (17%). It costs a sixth of the
burst and an eleventh of the puff, because it is a blit and they are strokes — see
`docs/frame-budget.md`.

**The paper is not in that count**, and that is correct: white on a white floor is nothing added, so
the figure is what a player sees appear.

## What a reviewer should look at, in order

1. **Panel 2 of the dpr 1 sheet.** Are all four words readable at 36 px on a non-retina display? Is
   the `O`'s counter open?
2. **Do the rays read as a 1930s impact, or as emphasis lines?** This is the one place the sprite
   knowingly departs from the words of the ask, and the reasoning is measured but the verdict is not.
3. **Do the four words look like one hand?** The lean, bounce and size wander per letter and are
   derived from the word's own index, so `BAM` and `BOP` share a `B` that is drawn identically and
   placed differently. Is that a hand or a stamp?
4. **`BAM` against the other three.** 18% more ink. Too heavy?
5. **The letterforms themselves.** `W` and `M` are the two most likely to be mush at dpr 1; the `Z`'s
   diagonal is the longest single stroke in the set.
6. **`sprite:frame`.** The only instrument that shows a word over a spider, a burst and a cloud at
   once. Does the mark read as one event told several ways, or as a pile?
