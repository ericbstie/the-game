# highlight — review notes

ADR 0002's third deliverable: what the blind reviewer said, what was done about it, and what was
deliberately left. A record, not a defence.

## What the reviewer was given

The **rendered frame**, not the review sheet — and told only that a tutorial was highlighting one
spot on the ground. No shape, no location, no idea what had been drawn.

That is a departure from the loop, and it is the right instrument for this sprite. The sheet shows a
mark on bare paper, and this mark's failure mode is not in the drawing: the fallback ring it
replaces was legible on paper and invisible on a metal-ore patch. The question was whether it can be
*found*, and only a frame asks that.

## What the reviewer said

Quoted as written, including the findings this sprite's author disagrees with.

**It found it.** "Found after a few seconds of scanning", not obvious at a glance. The candidate was
spotted unaided; the reviewer then cropped to confirm, and was explicit that partial analysis was
needed before it was *confident*.

**Style.** "Deliberate and consistent with the ink style — uneven brush width, a natural-looking
gap/break in the stroke, slight hand wobble, tapered ends. It reads as a sketched circle, not a
vector-perfect UI ring or a rendering artifact. It belongs in this art style."

**What does the work.** "Same pure black, same ink-line weight as walls, ore outlines, and character
sprites — no unique colour, glow, or dash pattern. The only thing that distinguishes it is its
shape: it's the one near-perfect closed circle in a frame otherwise made of organic blobs, jagged
ore edges, and small angular grass ticks. That geometric regularity is doing all the work."

**A competing mark.** "A second, thinner ring circling a player character ('Cy') elsewhere in the
frame… briefly competed with it as 'the' highlight." Raised twice, and said to "weaken uniqueness as
a look-here signal".

**The target is vague.** "That chunk is directly attached to a larger ore vein whose edge overlaps
the ring's boundary, so it's a little unclear whether the highlight means 'this exact chunk' or 'the
ore deposit generally.'"

**Obscuring.** The band "blacks out slivers of the ore texture under the line itself" and the label
crosses its top arc, but "nothing critical is lost — the ore chunk inside remains legible and the
text is fully readable."

## Why finding it at all is the result

[#154](https://github.com/ericbstie/the-game/issues/154)'s aim reticle was **never found**, across
five blind reads and four approaches, against the same background under the same monochrome
constraint. This was found on the first, unaided. Everything below is a note on a mark that clears
the bar the sibling ticket could not reach.

## The discrepancy, and it is not resolved

The author built for **flat mass** — an unbroken band with no white in it, against a texture that is
~30% ink in splinters and whose largest solid clump is a fraction of that. The reviewer credits
**closed-curve regularity** — the one near-perfect closed circle among organic blobs. Different
mechanisms, and only one of them was designed for.

Two further readings do not match the drawing:

- **"Same ink-line weight as walls, ore outlines, and character sprites."** The band is 8 to 12 u
  across. The ore's own shards are stroked at `SHARD_WEIGHT = 1.1` (`ore-metal.ts:22`). Whatever the
  reviewer was reading, it was not the measured weight.
- **"A natural-looking gap/break in the stroke."** There is no break. The stroke is continuous
  through an overshoot of 0.72 rad; what separates is the light lead-in, where the gesture crosses
  its own head.

One blind read cannot say which property did the finding, and in this sprite the two are
**confounded**: the only large flat mass in the frame is also the only closed regular curve. Telling
them apart needs a mark that has one and not the other — which is #154's problem, not this one's.
Recorded open.

## The competing ring is pre-existing art

It is the **self halo**. `halo.ts` describes itself as "a brushed circle drawn *around* the figure,
one continuous stroke that runs past its own start and crosses it" — the same idiom, arrived at
independently by another agent for the same reason: a ring round a thing is what marks a thing.

The reviewer named "Cy"; in this scene the halo is on the self avatar (`DEMO_SELF` is Ben) and the
three name labels overlap, so it named the nearest one. The finding survives the misattribution:
**two ring markers are on screen at once, and one of them weakens the other.**

The halo has a granted colour exception and this mark does not, so in principle they are separable —
but the reviewer's own words are "no unique colour, glow, or dash pattern", which is what a barely
yellow tint at low alpha comes to when it is not the thing being looked for. This is worth someone's
attention. It is not this sprite's to fix, and nothing was changed for it.

## What changed

**Nothing.** ADR 0002 §3 makes the reviewer advisory; the mark clears the bar that mattered, and
every remaining finding is either about art this sprite does not own or a judgement only a played
match can make. A second pass was declined rather than skipped.

## The author's open doubts, which the review corroborated

All four were in the author's report before the review came back.

- **The 84 u box says "over here" more than "this tile".** It encircles roughly a three-tile window,
  and the reviewer independently could not tell whether the mark meant the chunk or the deposit. The
  box is also the only lever for band width in the world, so shrinking it costs ore legibility
  directly — the two wants are opposed and the trade has not been played yet. Provisional.
- **The hand lives in the lower-left.** The lead-in, the crossing and the heaviest pressure are all
  on one flank; the upper right two-thirds is close to a plain arc. The reviewer read the drawing as
  hand-made anyway, which is the finding that was in most doubt before it came back.
- **The label crosses the top arc.** `saySay` cuts its words out of paper, so the ascenders in *mine
  to get metal* punch white through the band. Unavoidable at any box size the mark could have — the
  words are placed off the tile, not off the mark — and the reviewer confirmed the text stays
  readable.
- **The DOM host trade.** The band hugs the 56 px ammo button and covers its outermost few pixels of
  face rather than clearing it. This is forced: at 64 px, a band fat enough to beat the ore needs a
  ring radius of 31 in a box whose radius is 32. The icon and the count stay inside the hole. The
  blind review saw only the canvas host, so this is untested by anyone but its author.

## Where it stands

Pixel facts on the committed sheet, one bake, 84 px box:

| dpr | bake | ink | grey | ink share | covers |
| --- | --- | --- | --- | --- | --- |
| 1 | 84 px | 1832 | 955 | 66% | 80×77 at 3,4 |
| 1.5 | 126 px | 4227 | 1896 | 69% | 119×115 at 5,6 |
| 2 | 168 px | 7629 | 3117 | 71% | 159×153 at 7,8 |

No bake drew nothing and none touches the edge of its box. 84 is not one of the boxes where a
fractional dpr rounds badly — 84 × 1.25 and 84 × 1.5 are both whole.

Advisory, per ADR 0002 §3. This ships with the **mechanism** finding open — flat mass against closed
curve, unresolved — and with the halo collision recorded against whoever owns that sprite.
