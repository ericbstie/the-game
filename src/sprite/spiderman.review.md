# spiderman — review notes

ADR 0002's third deliverable: what the blind reviewers said, what was done about it, and what was
deliberately left. A record, not a defence.

**Two blind reviews, on two versions.** Each reviewer was given the sheet's path, the panel layout,
the house style and the four checks, and nothing else — no idea what the creature was meant to be,
which is the point. The second was also told to ignore the file's name, for the reason in the next
section.

This sprite was reviewed by a **stronger reader than the rest of the set was**. #154 drew seven
blind misses on a 1,440-pixel mark that all turned out to be reader failures rather than findings
(recorded on #143), so the reader was upgraded for the remaining visual work of this version. Both
reviews below did their own pixel analysis and both produced checkable claims; several are quoted
here precisely because they could be checked, and two of them turned out to be wrong.

## A taint worth recording: the first reviewer read the filename

The first review argued from the name. It reported that the drawing shows *"no red-and-blue, no web
pattern, no mask silhouette"* and that *"nothing about the shape says 'Spider-Man'"* — a superhero
nobody was drawing. The brief has to name the file it wants looked at, so this is a leak the
protocol cannot fully close.

It is recorded rather than discounted, because everything else in that review is descriptive and
stands on its own. The second reviewer was told the name tells it nothing, and answered: *"I would
not have guessed a humanoid at all without the filename, and the filename is exactly what I was told
to ignore."*

## What the first reviewer said

Quoted as written, including the findings this sprite's author disagrees with.

**What it thought it was.** "A solid black, amorphous blob — a bulbous round mass at one end tapering
into a narrow pointed snout at the other, with four or five thin spike-like protrusions radiating
from underneath. It reads as a low-slung crawling bug, tick, or rodent-like ink blot."

**Facings, at real size.** "#1 and #8 are essentially identical (snout pointing right/down-right);
#4 and #5 are essentially identical to each other (snout pointing left)… At best I can bucket these
into 'points right,' 'points left,' and 'other,' which is 3 readable states out of 8 claimed
facings."

**Its single most serious problem.** "The sprite is a single undifferentiated flat silhouette — 100%
solid black fill with zero stroke/contour and zero interior segmentation between head, body, and
limbs. There is no 'ink line over a fill' at all, because the fill and the line would both be black;
it's a flood-filled blob, not an inked cartoon character."

**Movement.** "Frame 1 has four leg-spikes, frame 2 has five… it reads as the whole body morphing or
glitching between two unrelated blob shapes, because a leg appearing/disappearing between frames
breaks object permanence in a way leg articulation shouldn't. There's no sense of weight shift or
gait, just a flicker."

**Artefacts.** "A thin white sliver near the snout tip, and a second white sliver between the front
two legs… irregular, jagged slivers, not clean shapes." "A small step-notch on the dorsal edge that
appears in frame 2 but not frame 1, with no anatomical explanation."

**Colour.** "I scanned every pixel in the file and found zero non-grayscale colors (`r==g==b`
everywhere)." Passes.

## What was wrong with it, checked rather than accepted

**"Frame 1 has four leg-spikes, frame 2 has five" is factually wrong.** Six legs are drawn in every
frame unconditionally — three pairs, both sides, no frame gating (`LEGS`, and the `walk` calls in
`draw`). Nothing appears or disappears.

What the finding is correct about is the perception, and it is the same finding the bloodling's
review produced: legs short enough to tuck under the body get absorbed into the mass, so the number
a viewer can *count* changes between poses even though the number drawn does not. That is a real
legibility problem wearing a wrong explanation, and it was not chased as an anatomy bug.

## What changed between the two reviews

One thing, and it was not something either reviewer raised — it came from the harness.

**The drawing ran over the edge of its box.** `sprite:sheet` measured **six of the sixteen bakes
touching the edge of their box**: facings 0, 3, 4 and 7, every touch horizontal. A grunt, an elite
and a bloodling each measure none. A bake that reaches the edge is shorn at it, so the two hooked
arms that are the whole of this creature's identity were being cut off in exactly the four facings
that lie flattest across the screen and show them best.

Fixed with a single scale at `plan()`, the one place every mark's position is computed, rather than
by pulling `ARM_REACH` back — the arms are not the only thing over the line, and shortening them
alone still left the abdomen clipping at every value tried. **`FIT` = 0.76 is measured, not chosen:
the largest scale at which no bake touches its box at all. 0.78 still clips one.**

Stroke widths were deliberately left out of the scale. They were set against a grunt's hip so this
creature survives a dense ore patch, and a thinner line is the one thing that must not follow from a
smaller body.

**The cost is real and is not hidden here: the creature is about a quarter smaller than it was
composed.** That is a loss of presence against the grunt it is meant to be told apart from, and the
author's own note is that if it reads as weedy beside one in a played frame, the right answer is a
re-cut at full size that fits — not a bigger box, which is tied to the collision radius and is the
sim's number rather than the drawing's.

## What the second reviewer said, on the corrected sheet

A fresh reader, told nothing about the first review or that anything had changed.

**Clipping — the one thing that was fixed, confirmed independently.** Asked directly whether any
part of the drawing is cut off at a tile edge: *"No — checked carefully, and I looked for this
specifically rather than eyeballing it… Every silhouette edge I inspected at high zoom is
organically rounded/antialiased, never a hard flat line that would indicate a rectangular clip."*

**Facings — unchanged, and the finding stands.** *"I cannot confidently call a facing for any of the
eight… At best 5 of 8 offer a coin-flip guess from an incidental bump; 3 of 8 offer nothing."*

**Its single most serious problem.** "The silhouette has no consistent identity across facings or
frames… bounding areas for the 16 panel-1 instances range from 2044 to 3184 px², with widths from 62
to 100px and heights from 51 to 76px, for what should be one rigid shape seen from 8 angles."

**A grey seam inside the fill.** "A diagonal streak of mid-gray pixels cuts through the solid black
fill in the tail/neck region… a run of `(102,102,102)`-ish pixels bisecting what should be solid
`(0,0,0)` fill, well inside the silhouette, not at its edge."

**Colour.** Passes again, independently: *"I scanned every pixel in the file for any channel
divergence >10 — zero colored pixels found."*

## The seam: checked, real, and left

An automated sweep of the whole sheet for interior greys — a mid-tone pixel whose neighbours three
pixels out in all four directions are solid ink — found **23 pixels in 1,800×1,392**, scattered and
mostly near-black. On that evidence the claim looked overstated.

It is not. Looking at the magnified panel directly, **frame 1 carries a visible thin light seam
running diagonally through the tail mass**, and the automated sweep missed it because it is about
one pixel wide and hugs a contour. The reviewer is right and the instrument was wrong, which is
worth recording on its own: a threshold that finds nothing is not evidence of nothing.

It is left. The cause is two filled paths meeting along a near-tangent — the arm's underside against
the abdomen — where each covers about half of the boundary pixels and the two composites do not sum
to opaque. Closing it means moving the arm or the abdomen, which is the geometry the facing read
already depends on, and the creature has been shrunk once this session already. It is one pixel, it
is on one of two frames, and at dpr 1 it falls below the sampling grid entirely.

## The finding this ships with open

**Both reviewers, independently, could not read the facings at real size.** Three of eight carry
nothing; the rest are a guess off an incidental bump. This is the third sprite in the set to draw
that finding — the bloodling shipped with the same one open, twice-reported — and it is not
dismissed here.

Two things are true at once and neither cancels the other:

- The silhouette **does** turn. Measured on the shipped sheet, coverage runs 32–51 device px wide
  across the facings against 27–44 tall, and the ink origin moves by 16 px between facing 0 and
  facing 4. Nothing is copy-pasted.
- **"It turns measurably" and "a player can tell which way it is pointing at 32 px" are different
  claims, and only the first is established.** The bloodling's notes say exactly this, and it was
  true there too.

**What the sheet cannot settle.** A player never meets this creature standing still on white paper
in a row of eight. It comes at you on the slant — it is the only oblique mover in the game — and
what says where it is going is that it is visibly *not* running at you. A static grid cannot show
that, and both reviewers were answering the question the instrument asked.

Advisory, per ADR 0002 §3 — the reviewer's findings are recorded and travel with the sprite, and the
final call is the author's, made by looking at the work in the game. This ships with the facing
finding **open**, twice-reported and not closed, and with the author's own doubt recorded above that
the fit scale has cost the creature presence.
