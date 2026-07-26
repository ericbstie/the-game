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

## Round 2

_(recorded below)_
