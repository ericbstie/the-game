# player — review notes

Reviews of `player.sheet.png`, one subagent per round, per
[ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md). Advisory,
not blocking. Each reviewer read the PNG and judged real size on panel 2, artefacts on panel 3 and
movement on panel 4.

Box **28** (`PLAYER_RADIUS × 2`), 8 facings × 2 frames, facing index per
[#73](https://github.com/ericbstie/the-game/issues/73) — 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N,
7 NE.

## How the 8 facings are made

One figure, evaluated at the facing's screen vector `(fx, fy) = (cos, sin)` of `facing / 8 × 2π`.
`fx` drives the snout, the eyes, the buttons, the stride and how far the body has turned; `fy`
drives whether the face is visible at all and which foot is stepping away from the viewer. Mirror
pairs are therefore the same drawing at opposite `fx` and cannot drift apart. Only two things are
authored rather than derived: the rear views drop the face entirely below `fy = -0.45`, and the
walk's leading leg is fixed to one side so it does not swap when the figure turns.

## Round 1

Author's own pass before the first reviewer, recorded because it changed the sprite most.

- Proportions were squat and read as a bear — body too long, legs too short, torso as wide as the
  hips. Rebalanced to the era's: head plus ears over a third of the height, shoulders narrower than
  hips, longer hose limbs.
- **Bug:** `fx === 0` never fired, because `Math.cos(Math.PI / 2)` is `6.1e-17`. Every "is this a
  straight-on view" test was silently dead, so front and back facings never got their splayed
  shoes. Fixed by snapping near-zero components.
- The muzzle was drawn as a white fill with a black stroke, and the stroke cut a line straight
  across the middle of the face. Replaced with a black shape laid down first and the white sitting
  inside it, so the contour exists only where the snout leaves the head.
- A tail was drawn and then cut. At 28 px it was a ~1 px squiggle that read as a stray mark rather
  than as a tail, and it is not among the features #76 fixes. Removed rather than defended.
- The bob was 0.9 px. A fractional vertical offset resamples the face against a different sub-pixel
  grid in each frame, so the head appeared to change shape rather than to move. Snapped to 1.

## Round 2

- **Arms invisible on six facings of eight.** Confirmed and fixed — see round 3's note on why the
  first fix was aimed at the wrong cause.
- **The shoes were outlined white ellipses** — the brightest mass on an otherwise solid black
  figure. They broke the ink language, read as light-coloured spats, and in profile the two
  overlapped into a single white pill. At dpr 1 the white interior collapsed entirely. Changed to
  solid ink; "oversized" is now carried by silhouette alone. This also removed a stray white pixel
  where the two shoe outlines crossed.
- **Uniform stroke width read as CAD linework, not ink.** `ctx.stroke` cannot vary its width, so
  the limbs are now filled polygons swept along the curve: thick where they leave the body, swelling
  through the belly, tapering to the hand or foot.
- **Exact symmetry is a generated-imagery tell.** The head now carries a slight lean, the two ears
  differ in size, the shoulders sit at different heights, and the two buttons differ.
- **The eye's wedge was too wide** and ate the oval into a hook rather than notching it. Narrowed,
  and its apex moved below the eye's centre so the bite comes out of the top only.
- **The nose floated in the white with a hairline of paper around it.** Pushed out until it meets
  the ink at the snout's edge, and tilted off the horizontal.
- **The legs stacked into one black pillar in profile.** The leading leg was tied to the opposite
  side from its lateral offset, so the two cancelled. Leading leg now matches its own side, and the
  feet rest fore-and-aft apart rather than squared up.
- Reviewer claimed nothing above the hips moves between frames. **Checked and false** — the bake's
  bounds put the top of the head at device row 2 in frame 0 and row 4 in frame 1. The perceptual
  point was fair, though, and the arm swing was strengthened.
- Reviewer measured the figure as "28 px wide, 50 px tall". **A misread** of the 2× panel; the
  measured bake covers 14 × 26.5 logical px.

## Round 3

- **The real cause of the buried arms: the torso and hips were drawn at full front-view width for
  every facing.** A body is wider across than it is deep, so a figure turned side-on shows a
  narrower torso — drawing one width for all eight facings left no room beside the body for an arm
  to read in profile. Fixed at the cause. Over-corrected on the first attempt (the profile body
  went spindly and the arm crossed the chest as a diagonal slash); dialled back, and the shoulder
  now sits forward in profile so the arm hangs instead of crossing.
- **The body read as one undifferentiated egg with two dots on it.** The shorts are now a garment
  in silhouette — narrow at the waist, flared, cut off by a straight hem the legs emerge from under.
  At this size silhouette is the only place a garment can be drawn.
- **The shoe was a perfectly symmetrical lens with no toe direction.** Now two lobes, a longer toe
  leading in the facing direction and a shorter heel behind.

## Round 4

- **Proportions were a plush toy, not a figure**: measured at head-plus-ears 49% of the height and
  legs 10%. Combined with round ears and an evenly framed white face, the front and rear views read
  as a bear cub. The head shrank, the waist and hips came up, and the visible leg roughly doubled.
- **Facing 0 was armless while facing 4 — its own mirror — had an arm.** The lateral offset of the
  hand was still being applied in profile, where it *added* to the forward reach on one side and
  *cancelled* it on the other. Collapsing the lateral split to zero in profile makes the two facings
  exact mirrors by construction, so the class of defect cannot recur.
- **The shoes had fused into a single black plinth**, wider than the ears and the widest part of the
  whole sprite. Both lobes were shrunk, and the trailing foot now lifts in profile so there is a step
  in the silhouette where two overlapping shoes would otherwise merge.
- **Front and rear facings were the same drawing with the face filled in.** The shoe's toe now
  foreshortens through `fy` as well as `fx`, so feet running toward the camera and feet running away
  are different shapes.
- **Frame 0 of the straight-on facings was a perfect bilateral mirror** — 86% (S) and 93% (N)
  identical — which is the classic generated-art tell. Straight-on facings have no `fx` to break the
  symmetry, so it is now carried by the parts: the two feet rest at different widths, the shoulders
  and hands sit at different heights, the ears differ in size and height, and both eye wedges lean
  the same way rather than mirroring into matched brackets.
- **A dashed grey chain under the muzzle read as a mouth nobody drew.** It was the snout's contour
  ring, which was being drawn on every facing including those where the snout never leaves the head.
  It is now drawn only where the snout actually breaks the outline.
- **Two buttons merged into a light band across the hips** on the three-quarter facings, reading as a
  slot cut through the body. Drops to a single button once foreshortening closes the gap.

## Measured, not eyeballed

Two checks that the picture hides, run against the real baked pixels:

- **Every bake is a single connected ink mass** — 4-connected component count is 1 for all 16 bakes
  at dpr 1 and at dpr 2. This is the check for the failure where a later shape's white fill severs an
  earlier shape's outline and limbs quietly detach. This sprite draws no white keylines at all — the
  only paper is the face, the snout and the buttons, all of them enclosed by ink — but that is a
  claim worth measuring rather than asserting.
- **Frame-to-frame movement above the hips is real.** The bake's bounds put the top of the head at
  device row 2 in frame 0 and row 4 in frame 1, and both frames share a bottom row, so the figure
  bobs without leaving the floor.

## Known and accepted

- **Contours carry grey.** Roughly 40% of covered pixels at dpr 1, 34% at dpr 2. This is resolution,
  not wrong ink, and every workaround was measured and rejected in
  [#77](https://github.com/ericbstie/the-game/issues/77) §4. Not fixed, deliberately.
- **Two bakes touch the bottom edge of their box at dpr 1** — facings 2 and 6, frame 0. That is the
  soles, and it is correct: `drawWorld` blits this box with its bottom edge on the player's
  position, so a foot-anchored sprite belongs on that edge. Nothing is clipped.
- **The same leg leads in every stride.** With two frames and frame 0 reserved as a standing stance
  (#81), there is no frame left to alternate the lead. The bob and the arm swing carry the walk
  instead. Changing this needs a third frame, which the spec does not grant.
- **Rear facings (5, 6, 7) carry no face** and are read by silhouette alone. That is what a back
  view is; the snout still shows past the head on the three-quarter rears so they do not collapse
  into the straight-back view.
