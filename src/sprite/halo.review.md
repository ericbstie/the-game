# halo — review

The self marker. Painted **behind** the avatar and centred on its **body**, so it is always seen
with a 28 px figure standing over its middle. `drawWorld` asks for `("halo", 0, 0)` and nothing
else.

## The box: 52

#81 fixes no size for this one, so this is the decision and its reasoning.

- **It has to clear the figure.** Round 1 found the first attempt (44) too tight: the ears sat on
  the inner edge of the stroke, so the head interfered with the contour and broke the ring's
  outline. At 52 the stroke's inner edge is ~2 px clear of the avatar's box at the top and more at
  the sides, so the circle stays closed with the figure standing in it. A closed ring is far
  stronger to spot than two disconnected arcs, and that gestalt is the whole mechanism.
- **It has to survive a spider standing on it.** The ring is drawn *outside* the avatar's
  silhouette, so an enemy on top of you cannot erase the marker — round 1 named that the one
  property not to break. A bigger ring also means a 32 px grunt fuses with less of it.
- **The tint needs area.** Round 1's decisive finding was that the tint, not the ink, is what
  survives distance and occlusion, and that more of it must be bought with **area rather than
  saturation**. 52 is what the warm annulus needs to reach past the ink without clipping the box.
- **It must not become the largest thing on screen.** Its ink is a ~2 px line, not a mass: 468 ink
  pixels at dpr 2, against a 28 px figure that is mostly solid fill. It is one mid-spider's worth
  of ink.

`frames: 1` — not a preference, a fact: `draw.ts:437` calls `sprites?.("halo", 0, 0)`, so a second
frame would never be asked for. A pulse would have been the cheapest pre-attentive cue available
(round 1 suggested one on the tint), but it would need a call site that does not exist, and
inventing one is not this sprite's to do.

`facings: 1` — it does not turn.

## White ink on a white floor

The stated problem, and what the design is organised around. Two channels, because neither is
enough alone.

**The ink carries the shape.** On white paper a mostly-white glow has almost no value contrast.
Measured on the real composite over the floor:

| Where | Composited over white paper |
| --- | --- |
| Bare paper | `255,255,255` |
| The stroke | `0,0,0` |
| The tint at its strongest, on the stroke | `≈255,250,236` |
| The outer step | `≈255,253,246` |

A 19-unit drop in one channel finds nothing on its own. The black does.

**The tint carries the distance.** Round 1's squint test was the finding that changed the design:
blurred to peripheral vision, the marked figure was merely the *dimmest dark blob on the field* —
because the ink signal competes with 240 spiders made of the same ink. The warmth is the one
channel nothing else in a black-and-white game has, so it is what survives being small, blurred or
half-covered. Stripping it degraded the mark to a grey ring smudge indistinguishable from a faded
spider. It is load-bearing and it is spent as **area**: the tone stays at the faintest step that
reads and reaches further instead.

**It is an annulus, not a disc.** The first version filled the circle. Rendered into a real frame
it came out as a flat grey puck behind the player — a shadow, or a selection marker, and something
any entity might cast. Round 1 independently read the same thing as *bubble / egg / coin*: a closed
rim around a pale fill makes the figure look contained, which is backwards. You are marked, not
trapped. Light around the stroke reads as light; a plate under the feet does not, and it hides its
own centre for nothing since the avatar is standing there.

## Why the tint is out of register rather than blurred

A soft radial bloom under the ink is a modern glow filter and reads as one; offset downward it
reads as a drop shadow. The tint is three **flat** tone steps — a ladder, not a gradient — printed
0.6 px left and 0.7 px up of the black. That is what a two-colour press of the period did, it reads
as ink and paper rather than as light, and the offset breaks a symmetry a halo otherwise cannot
avoid.

## Against the known generated-image tells

A halo is the most naturally symmetric thing in the set, so these were designed against explicitly.

- **Perfect symmetry** — the stroke is one continuous pass that **runs past its own start and
  crosses it**, the way a hand circles something on paper. It also tightens as it goes, and the
  contour carries a slight vertical oval plus three harmonics off true.
- **Sub-pixel irregularity, which is the same as none.** Round 1 caught this: the first wobble was
  0.026–0.014 of a 16.5 px radius, i.e. under one device pixel at dpr 1, so the intended hand was
  real in the code and invisible on screen — a CAD circle at play size. The amplitudes are now
  sized to be worth 1–2 device pixels at dpr 1.
- **Uniform stroke width** — modulated continuously by angle, heavy twice per turn on a nib's
  diagonal and heavier on one of those than the other, so the ring is not symmetric about its own
  axis either. Canvas has one `lineWidth` per call, so both edges of the stroke are traced as a
  filled path to get this at all.
- **A stroke under 1 px** — floored at 1.15 logical px. The only exception is the two tapered
  points at touch-down and lift, which are points rather than lines that came out too thin.
- **Axis-aligned regular fields** — none: no hatching, no dots, no mesh.

Anti-aliasing is left alone (#77 §4).

## Reading the harness's numbers

`sprite:sheet` reports **ink 468, grey 5101 — "ink is 8% of covered pixels"**. That figure reads
backwards here and should not be taken as a defect. "Grey" counts every pixel that is covered but
not near-black, and this sprite's tint is a large, deliberately faint translucent area; on a white
ground it is the *point*, not a smudge. The ink count is the number to watch.

## Round 1 — what the reviewer said, and what was done

Reviewed against `crowd.png` (six identical figures, twenty-two spiders, white floor, real size)
as well as the sheet.

| Finding | Action |
| --- | --- |
| **Must-fix.** Collapses when a spider straddles the ring — the stroke fuses with the spider and the circle breaks into an arc | Ring enlarged, and the tint made an annulus reaching past the ink, so the warm mark survives what the ink cannot |
| **Must-fix.** Ink-only signal is not pre-attentive; under a squint test the marked figure is the *dimmest* blob on the field | Tint spent as area rather than saturation, and moved off the centre onto the stroke where the eye already goes |
| **Must-fix.** The wobble is sub-pixel — at play size this is a CAD circle, the artefact it was written to avoid | Amplitudes raised to 1–2 device px at dpr 1, plus a vertical oval |
| **Must-fix.** The overshoot tail lands on the avatar's head and reads as a chip or a stray wire, and ends in a blunt cut | Moved: the tail now swings *outward* and crosses its own head in open paper at the lower-left, and both ends taper to a point |
| `INK = "#111111"` is off-palette against every other sprite | Now `#000` |
| Ring tighter than its own comment claimed; ears interfere with the contour | Ring enlarged; comment corrected |
| Reads as a UI selection ring, secondarily as a bubble/egg/coin. The "iris-out" reference in the code does not land — an iris-out is a black matte closing from the frame edge, not a small drawn ring | Reference dropped. The bubble read is addressed by emptying the centre |
| The three-step tint ladder flattens to one tone; the comment describes something that is not happening | Steps re-spaced so the ladder is real |
| **Do not break:** the colour value is exactly on brief — do not strengthen it | Unchanged |
| **Do not break:** the ring sits outside the avatar's silhouette, so enemies cannot erase the marker | Preserved, with more margin |
| **Do not break:** the nib width variation is convincing hand-work; the tint is load-bearing at distance | Both kept |

## Round 2 — after the floor turned white

The floor landed as white paper mid-flight, and it inverted the constraint. A "barely yellow,
mostly white" glow had value contrast against the old near-black ground and has almost none against
paper. The warmth stopped being able to carry the mark at all; the ink had to.

This round was judged on a **real frame of the game** (`sprite:frame`, the shipped renderer, the
real floor, the real sprites, three players in a cluster) as well as the dense crowd test. The
reviewer measured the sprite rather than eyeballing it, and the measurements are why the fixes are
what they are.

| Finding | Action |
| --- | --- |
| **Must-fix.** The ink circle was only **35 px across in a 52 px box** — the box was sized for the glow, not the mark. Inner diameter ~30 around a 28 px avatar is ~1 px of clearance: no moat, so neighbours land *on and inside* the ring and it survives as a broken C rather than a closed circle | Radius grown from 0.315 to 0.385 of the box, and the glow pulled in to hug the stroke, so the box is now sized for the ink |
| **Must-fix.** Time-to-find in a real frame was **bad** — the reviewer's eye went to the ore, the nest and the egg sac, and could not name the marked player without magnifying. "A 2 px hairline loop loses to every large black mass" | Stroke weight raised from 2.9/1.45 to 4.2/2.1. Ink per bake went 468 → 1185 px: it is now an ink *mass* rather than a line, which is what competes on a field of black masses |
| The lower-left crossing did not read as one — the thin start was **absorbed** into the full-weight finish, with no open paper between them | Drift and hook deepened so the tail runs clearly inside the head and then swings clearly outside it, leaving paper on both sides |
| Thin spot at ~300° dropped to 1.0 px and rendered mid-grey at dpr 1 | The raised floor (2.1) removes it |
| The glow reached 30% wider than the ink and read as a smudge attached to the *neighbouring* figure | Tightened to hug the stroke |
| The glow's chroma measured 5/11/18 out of 255 — "safely barely yellow, no risk of reading as yellow", but contributing nothing; ceiling before it tips is ~24–26 | Alphas raised one step, to a measured peak near the middle of that range. Not cut: it is the print gag and the only warm thing on the field |
| **Not this sprite's to fix.** In the real frame a *neighbour's* name label falls inside the ring while the marked player's own label sits outside it — a player glancing at that reads the wrong name | Reported. Label offset and z-order belong to the HUD/integrator; no ring size fixes it while labels sit above heads and players can stand 12 px apart |
| **Do not break:** blurred to peripheral vision it is *the only shape on the field with a bright enclosed interior* — every other mark blurs to a solid dark blob. That empty light core is the entire signal | Preserved; the centre is bare paper and the enclosure is now stronger |
| **Do not break:** it reads as a pen mark — not a glow, bloom, drop shadow, selection ring or CAD circle. Width measured 1.0 → 3.0 px around the arc, a 3:1 range: genuine nib behaviour, no symmetry, no axis-aligned fields, no moiré | Kept; the range widens rather than flattens |
| **Do not break:** not confusable with the egg sac — that is a filled cracked shell with a jagged rim and a ground shadow; this is a thin loop with light inside | Kept |

## Round 3 — the pen was going down in the wrong place

The specification passed on the round-2 build: *"blurred, every figure and spider collapses to an
identical amorphous blob and the marked figure is the only thing that survives as a recognisable
ring."* That is the whole job, and everything after it was protecting it.

Three faults remained, and they turned out to be one. The pen went down at the **bottom** of the
circle, near both the y axis and the nib's own heaviest angle, so the finishing stroke ran at full
weight straight along the bottom on top of its own start:

- the crossing was an absorbed lump rather than an X — a whisker on a slab, with no open paper
  between the tail and the finish;
- the bottom-left measured 4.1–5.6 px against 1.7–3.0 px elsewhere: the extra weight had been
  dumped where the two runs overlap;
- and the overlap left a dead-horizontal ~11 px edge along the inner side of the stroke, which is a
  machine tell however good the rest of the mark is.

Moving the touch-down to the **upper-left diagonal** — where the nib's weighting is naturally
lightest, and off both axes — fixes all three at once. The overshoot was also shortened so the tail
cuts *across* its own head steeply instead of running parallel to it, and the stroke now thins
through the whole overshoot, so the finish crosses as a whisker over a line instead of pooling.

Two things were separate: the weight modulation read as a monotonic thin-top-to-fat-bottom
gradient, so it gained a third-harmonic tremor and now has three separated heavy lobes; and the
oval was flattened for clearance.

Verdict: **ship it**, no must-fixes. Measured on the final build:

| | |
| --- | --- |
| Stroke width by clock | 1.2 px at 10 o'clock to 4.1 px at 7 o'clock, three heavy lobes with thin zones between |
| Crossing | four limbs from one node at 10:30, tail projecting 3.5 px past it with open paper on **both** sides |
| Clearance | tightest inner radius 15.1 px against the avatar's ~14 — outside the silhouette everywhere |
| Warmth | peak `255,251,232`, R−B = 23, ~9% saturation; zero inside r=9 and outside r=25, so it hugs the stroke rather than filling the circle |
| Artefacts | one connected component at both thresholds — no detached specks, no axis-aligned edge, no moiré, no symmetry |
| dpr 1 | holds; the whisker and tail go grey but neither vanishes, and neither carries findability |

Two notes recorded rather than acted on, because they are not this sprite's:

- **A neighbour's name label can fall inside the ring** while the marked player's own label sits
  outside it — in a real frame that reads as the wrong name at exactly the moment a player is
  hunting for themselves. Label offset and z-order are the HUD's; no ring size fixes it while
  labels sit above heads and players can stand 12 px apart.
- In a tight three-body cluster the ring overlaps both neighbours and costs a beat to resolve which
  figure it encloses. Inherent to a ring large enough to clear its own avatar.
