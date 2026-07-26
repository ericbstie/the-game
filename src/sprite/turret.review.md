# Turret — review notes

The sprite is `src/sprite/turret.ts`; the sheet is `src/sprite/turret.sheet.png`. Reviews are
advisory ([ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)),
so this records what was said, what was done about it, and what was deliberately not done.

Fixed by the brief and not open to review: the box is 30 (a 2×2 footprint at `TILE` 15), the
projection is elevation, the sprite is anchored bottom-centre, it is static, and **it never
rotates** ([#76](https://github.com/ericbstie/the-game/issues/76), confirmed in
[#73](https://github.com/ericbstie/the-game/issues/73)). The unpowered lightning symbol and the
health bar belong to other sprites and are absent on purpose, as are damage states, which #76 cut.

`facings: 1` — the contract leaves the count to the author, and a structure that never rotates and
has no states has exactly one variant.

Five drawings were made and four were reviewed by a subagent that read the sheet. Every round was
told to be blunt and told the history, so it could not be flattered by improvement.

## What kept going wrong

Three faults recurred across rounds in different clothes. They are the useful output of this file:

1. **A cap on a stem on a foot is furniture.** Dressed as a dome, a cupola, a drum and a flared
   stack, it was read as a chess pawn, a desk bell, a table lamp, a mushroom, a bandstand, a desk
   telephone, a toaster, a bread bin, a chess rook and — in a brief that asks for ink — an inkwell.
   Reviewers independently blamed **the waist**. There is no narrowing anywhere in the final sprite.
2. **White knocked out of a black mass is a pictogram, not ink.** Called out in round 1, it returned
   in round 2 as an interior port band and in round 3 as a top slot and a front panel. Round 4 fixed
   the base but left the top half in the old grammar, and a reviewer caught that the sprite then read
   as *two objects* in two incompatible value grammars. The final sprite uses one grammar throughout:
   white forms carrying a bold ink contour, with solid black spent only on the bore ring, the
   roofline, the coupling and the weight at the floor.
3. **Detail smaller than about 2 px does not exist at this size.** Round 2's gun ports and round 3's
   battlement gaps both came out around one pixel wide and read as fringe or vanished entirely.

## Round 1 — dome on a rim on a plinth

**Found:** reads as a **chess pawn or desk bell**; built from **icon-style knockouts rather than ink
contours**, which is the failure the art direction exists to prevent; **the rim dominates instead of
the dome**.

**Done:** rebuilt rather than patched.

## Round 2 — cupola with an interior port ring, on a pinched neck

Reviewed twice, independently, because the first reviewer was slow to report. The two agreed almost
completely, which is the strongest signal in this file.

**Found:** reads as a **mushroom, table lamp, desk telephone or bandstand**. Both reviewers named
**the waist** as the cause. Ports punched *inside* the outline **vanish at real size** — strip them
out and the silhouette is unchanged. Two thirds of the sprite was still knockout construction. The
plinth, not the dome, dominated: one reviewer measured **62% of the ink sitting in two featureless
horizontal bars**. The omnidirectional intent failed on its own terms — the ring stopped well short
of the silhouette edge, so it read as three windows on a front face, not as a ring.

**Disagreement, resolved against the sheet:** one reviewer reported the base overflowing the bottom
of the box. It does not — the harness measures the ink inside its box, and a floor-standing
elevation sprite is *supposed* to reach the bottom edge, which is why the harness's "touches the
edge of its box" line is expected here rather than a fault. The second reviewer verified the bake
was exactly bilaterally symmetric and clean. The first reviewer's claim was dropped.

**Not done:** the same reviewer asked for the bake to be **thresholded to 1-bit** to remove grey
from the curve. Rejected — #77 measured that thresholding shatters curves into a visible staircase
and breaks thin strokes into dots. It passes a numeric check and looks wrong. Resolution is the fix
and the harness already bakes at `size × dpr`.

## Round 3 — battlemented drum with an embrasure

**Found:** reads as a **toaster, bread bin or chess rook** — "you moved along the chess set, not off
it". Nothing said weapon. Battlement gaps came out **~1 px at real size**: fringe, not crenellation,
and the outer merlons merged into the walls. The top ellipse **tapered to sub-pixel at both ends** and
smeared to grey. Knockout construction had returned. The battlement ring did not read as continuing
around the back, because nothing interrupted the near edge of the top surface.

Its top-ranked fix — **a muzzle on the vertical axis**, direction-neutral under every fire
direction — was taken.

## Round 4 — bevelled casemate with a flared muzzle

**Found: not shippable.** Reads as an **inkwell**, then an oil lamp. Three mandatory fixes:

- **A solid flared trapezoid is a funnel, not a gun.** An opening that widens upward reads as an
  intake, and a closed black shape cannot say "you are looking into a bore".
- **The waist was back**, smaller: the neck was narrower than the flare above and the body below.
- **It collided with the miner.** The miner's most distinctive mark is a black inverted trapezoid
  funnel; that was also the turret's only distinctive mark. Two 2×2 structures cannot share their one
  distinguishing silhouette. Verified directly against `miner.sheet.png` — the reviewer was right.

## Round 5 — wide, low casemate with a bore in its roof

The current sprite, and the response to all three. The bore is an **annulus with the hole knocked
out white** and foreshortened into the roof plane, so it reads as something you look *into*; there is
no neck and no narrowing anywhere; and the sprite is **wider than it is tall**, which is the axis the
miner leaves free (the miner is tall, busy and asymmetric; the wall is a filled square). The roof
plane is narrower than the front face, so the two planes are separated **in the outline** rather than
by a line drawn across a flat shape.

Two smaller notes were also taken: a coupling on one flank breaks the exact mirror symmetry that
reviewers flagged as the tell of generated art, and every white gap is at least 2 px at real size.

Being wide and low has a second benefit nobody asked for: the ink line of a shot fired *down* the
screen crosses much less of the turret's own body.

Reviewed once more after it was drawn, against the miner and the wall.

**Verdict: shippable, no must-fix.** All three mandatory fixes landed — the bore reads as a bore at
real size, the neck is gone, the form is wide and low. The furniture family is gone with the waist:
the remaining resemblances a reviewer offered were a flatbed scanner and a hotplate, which are squat
installations rather than things that stand on a stem. The funnel collision with the miner is
resolved — the turret's trapezoid is a *contoured top surface in perspective*, wide at the bottom and
hollow, the inverse of the miner's solid funnel.

Turret and miner remain the closest pair in the set, separated by the top edge: the miner breaks its
own top line with two protrusions, the turret's is clean, flat and wide. **Nothing should ever be
added above the turret's top line**, because that distinction is what carries it.

Both of the round's nice-to-haves were taken: the white gap above the bore rim was widened off the
2 px threshold, and the flank coupling was moved clear of the wall so it reads as its own fitting
rather than as a thickening of the contour. It is kept rather than deleted because it is the only
thing breaking an otherwise exact mirror symmetry, which is itself a tell of generated art — and
because the asymmetry is spent on a fitting low on the body, where it cannot be mistaken for an aim.

## Checked at both densities

`--dpr 1` as well as the default 2, per the contract. At 1× the bore still reads as a ring with an
open centre and the roofline and coupling survive. Grey runs high on the sloped shoulders at 1×;
that is the diagonals having too few pixels, not wrong ink, and per #77 it is left alone.

## Open, and left open

The style still leans geometric rather than rubber-hose. Reviewers repeatedly asked for contour weight
that swells and tapers, and at 30 px across a shape this small every attempt at modulation either
disappeared or turned into the sub-pixel smear that round 3 was faulted for. The sprite ships bold and
even rather than modulated, and that is a judgement the author makes by looking at it in the game.
