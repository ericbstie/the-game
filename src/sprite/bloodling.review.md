# bloodling — review notes

ADR 0002's third deliverable: what the blind reviewer said, what was done about it, and what was
deliberately left. A record, not a defence.

The reviewer was given the panel layout, the house style and the facing order, and nothing else —
no idea what the creature was meant to be, which is the point.

## What the reviewer said

Quoted as written, including the findings this sprite's author disagrees with.

**What it thought it was.** "Two overlapping color blobs stacked diagonally: a solid green ellipse
sitting on top of a solid purple/violet ellipse, with a smaller darker violet oval nested inside the
purple lobe, and a few thin scratchy dark squiggles poking out at the bottom. On its own, with no
label, this reads as a two-toned blob or berry cluster — not as any specific creature. It has no
head, no eyes, no limbs I can identify with confidence; the 'legs' register as noise before they
register as anatomy."

**Its single most serious problem.** "The 8 compass facings are not actually differentiated — the
creature never visibly rotates or changes silhouette across E/SE/S/SW/W/NW/N/NE, which is the one
thing a directional walk sheet exists to prove."

**Panel 2, readability.** "Almost everything is lost… a green smudge over a purple smudge… zero
facing information surviving: all 8 icons look interchangeable."

**Panel 4, movement.** "The body is completely static between frames… only the thin scratchy
leg-lines flicker. The net effect is a twitch/jitter of noise at the base, not a walk cycle… like
the sprite is vibrating in place while the body floats motionless above it."

**Style.** "The nested darker-violet oval inside the purple lobe is interior shading/detail that
shouldn't be there under [the no-interior-detail] rule." The outline is "visibly uneven in
thickness, bulges in some spots and thins in others, looks traced/auto-generated rather than
hand-inked." The leg squiggles are "thin, wavering, inconsistent stroke width, more like scribbled
noise than deliberate linework."

**Artefacts.** The inner oval's outline "looks incomplete/open in one frame — doesn't cleanly close
against the purple fill boundary"; "soft color fringing/blur at the edges"; the leg squiggles differ
in "seemingly random counts and positions."

**Anatomy.** "No head is identifiable. No front or back. No eyes, no mouth, no distinct limb
structure."

## The correction that came with it

The claim that the facings are not differentiated at all was checked numerically against
`sprite:sheet`'s own per-bake facts on the reviewed sheet, and it is **factually wrong**: ink ran
448–576 across the sixteen bakes and the coverage boxes varied, with facings 5–7 sitting about 20%
lower in ink than 0–4. Nothing was copy-pasted eight times, and that was not chased as a bug.

What the finding *is* correct about is the perception, and the author's own report said the same
thing more quietly before the review came back: that facings 5, 6 and 7 were close, that what
survived at 32 px was "green dome, purple base, dark ticks for legs", and that the snout read as a
second body segment. A reviewer told there were eight facings and unable to tell them apart is that
same finding said louder.

## What changed

Three findings were acted on. They turned out to be two problems.

**The nested oval and the flat facing read were the same bug.** The snout was drawn as its own
ellipse *on top of* the body ellipse, and it was almost entirely inside it — so its contour was a
closed ink ring floating in the purple (which the reviewer read, correctly against this style, as
interior shading) and the one part of the drawing that moved most between facings contributed
nothing to the outline. Both are fixed by the same change:

- The carapace is now **one path**. The body ellipse and the snout ellipse go into a single
  `beginPath` and are filled once, so the nonzero rule takes their union under a single contour.
  There is no interior line left to misread, and the "outline doesn't cleanly close against the
  purple fill boundary" artefact went with it — there is no inner outline.
- The snout's **reach was pushed out** (`SNOUT_REACH` 5.6) so it breaks the body's outline at every
  facing it is visible in, and it hangs off the body on the **flattened plan** (`PLAN` 0.68) that
  the jaws, the sack's trail and the ring of feet all now share. The purple silhouette is therefore
  a teardrop that points where the creature is going — out to the side in profile, down at the
  viewer in the charge, hidden behind the sack in the rear views.
- The **sack trails on that same plan** instead of holding a fixed height. An earlier cut froze the
  sack's height on the grounds that perspective (behind ⇒ lower) and elevation (on the back ⇒
  higher) cancel. They do cancel, and the cost was exactly that facing 2 and facing 6 came out the
  same drawing. Height no longer wins outright: the sack now swings 4.1 px vertically between the
  charge and the retreat as well as 6 px laterally between the two profiles.

**The static body.** There was a 1.3 px bob and a sack stretch, and a fresh eye saw neither, because
every mass moved *together* — a whole-sprite translation is invisible when there is nothing to
translate against. The motion is now relative:

- the carapace drops on the bob and **the sack rises against it** (`SACK_LAG` −0.35), so the two
  masses close and open by ~1.75 logical px rather than sliding in parallel;
- the sack stretches 6% as it goes;
- the whole creature **sways across its own heading** (`SWAY` 0.55) on the flattened plan, so the
  second frame is a different pose and not the first one lower down.

**Leg linework**, as a cheap side-fix rather than a rework: the belly swell that was making the
stroke width wander is down from 0.35 to 0.12 and the tip is up from 1.6 to 1.9, so a leg is a
tapered limb of near-even weight instead of a wavering squiggle. The count and placement are *not*
random — six legs on fixed bearings, walking an alternating tripod — but they were reading as
random, and evening the weight is what was available without rebuilding them.

## What did not change, and why

- **No eyes.** The reviewer wanted a face. This was a decision before the review and it stands: the
  snout is 8 px across, which puts an eye at three device pixels, and at three pixels a paper round
  on a dark curve is indistinguishable from the specular highlight nothing else in this game has —
  the trap `elite.ts` documents. The face is a pair of ink jaws instead, which are silhouette rather
  than interior detail and so survive at real size the way the claws do. They are still only ~3 px
  and they still do most of their work on the contact grid.
- **"Soft color fringing/blur at the edges."** This is anti-aliasing, not a defect, and panel 1 is a
  2× upscale of a 64 px bake. `docs/sprite-loop.md` records that every fix for it was measured and
  rejected. What *was* actionable — a contour too light to survive dpr 1 — was already handled by
  weighting the line at 1.7 for the non-retina case, which is why ink is 31% of covered pixels at
  dpr 2 and 18% at dpr 1 rather than 24% and 12%.
- **"Uneven outline thickness."** Partly real and partly the style. Adding a constant to a varying
  radius is not a constant-width offset, so the sack's lumps do thin the ink where the outline bends
  outward. The lumps were cut from ±9% to ±5%, which reduces it; they were not removed, because a
  perfectly even machine offset is the other failure mode and the swelling line is the rubber-hose
  part.
- **The union's waist.** Outsetting each lobe rather than the union thickens the ink slightly where
  the body and snout meet. That is what a pen does at a joint, and the alternative — a true offset
  of the union — puts a concave notch there instead.
- **The rear three facings are still the closest to each other.** From behind, a creature carrying a
  sack on its back mostly *is* a sack. They are now parted by the sack's vertical swing, the body's
  lean and the leg fan, and no further.

## Where it stands

Pixel facts on the committed sheet, dpr 2, 64 px bakes: ink 394–495 per bake, 31% of covered pixels
across all sixteen; coverage boxes 50–54 wide by 39–56 tall, starting between y 5 and y 13. No bake
drew nothing and none touches the edge of its box. At dpr 1, ink is 18% of covered.

The author's remaining doubts: the jaws are effectively invisible below the contact grid, and the
sack's lumps read as an ellipse at 32 px.

## The second blind review — on the revised sheet, and it did not clear

A second reviewer, a fresh one with no knowledge of the first review or that anything had changed,
was shown the revised sheet under the identical brief. It reached the same verdict, and its finding
stands unresolved:

> **Most serious problem:** The eight compass facings don't actually encode direction — they reduce
> to two interchangeable poses (legs-visible for E/SE/S/SW/W, legs-hidden for NW/N/NE), with no
> differentiation between facings inside each cluster. A directional sprite sheet that can't tell
> the player which way the creature is facing, at any zoom level including the one they'll actually
> play at, has failed at its one job.

On panel 2 specifically: *"All eight thumbnails look almost identical to each other. I cannot tell
which way any of them are facing."* On the creature: *"two-lobed slime … there is no head-shaped
element, no eyes, nothing that reads as 'front.'"* On the walk: *"only the thin leg/spike scribbles
change, and they change unpredictably … noise superimposed on a motionless blob."*

**This supersedes the claim made above that the facings are legible at real size.** Two independent
reviewers, on two different versions, said they are not, and the author's own notes concede the rear
three are the closest. The revision fixed what was structurally wrong — the interior contour is gone
and the silhouette now turns, which the pixel facts confirm (ink origin varies by 8 device px across
the facings against a constant 7 before) — but "it turns measurably" and "a player can read which way
it is pointing at 32 px" are not the same claim, and only the first is established.

**What the sheet cannot settle.** A player never sees this creature standing still. It runs at you,
bleeds a trail behind it as it goes, and the trail is the direction. A static grid is the wrong
instrument for the question, and both reviewers were answering the question the instrument asked.
That is a reason to decide it in the game, not a reason to treat the finding as answered.

Advisory, per ADR 0002 §3 — the reviewer's findings are recorded and travel with the sprite, and the
final call is the author's, made by looking at the work in the game. This ships with the facing
finding **open**, twice-reported and not closed.
