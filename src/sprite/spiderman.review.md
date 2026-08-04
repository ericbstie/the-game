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

## Round 3 — the seam, half closed and half left (#171)

**Superseded below: the diagnosis in "The seam: checked, real, and left" was half right.** It named
the cause correctly — two filled paths meeting along a near-tangent, each covering about half of the
boundary pixels — but concluded that closing it "means moving the arm or the abdomen". It does not,
or not entirely. The compositing half closes with no geometry moved at all.

`draw` was issuing **eleven separate `beginPath()`/`fill()` pairs per frame** — body 1, arms 4,
legs 6 — all in one `INK` fill with no strokes anywhere. The tail is where the artefact became
visible; every other join carried it latently. Every subpath is a disc laid down as `moveTo` +
`arc(…, 0, TAU)`, so they all wind the same way and the nonzero rule takes their union. `hose` and
`body` now add to the caller's path, and `draw` wraps the whole animal in one `beginPath()`/`fill()`.

Two filled paths compositing give `a + b(1-a)`, which is **less** than their true union wherever the
two coverages are disjoint inside a pixel. That is the whole artefact, and it is why the union is
darker rather than lighter.

**Measured, all 16 bakes.** Grey falls in every one, ink rises in every one, and ink goes from 77%
to 79% of covered pixels. Read as baked pixels at the seam itself, `.` (near-white) became `o`
(mid), and one `+` became solid ink.

**The silhouette is unchanged in 14 of 16 bakes.** Two lose one device pixel of width at dpr 2 —
facing 1 frame 0 and facing 5 frame 0, both 34 wide to 33. That is the same defect read from the
other side: the outermost lane was being lifted over the coverage threshold by compositing that put
down more ink than the geometry actually covers. The union reports honest coverage. The author
predicted all 16 would be identical and was wrong; it is recorded because the prediction was made
on the ticket before it was checked.

**What is left, and why.** The seam is reduced, not closed. With one path and one fill, parts can no
longer composite against each other, so the residue is genuine geometry — a hairline where neither
mass quite covers the pixel. Two closures were found and both were declined here:

- **A hairline stroke of the same path in the same ink.** Measured: `lineWidth` 0.3 is the smallest
  that closes the seam completely. It closes it globally too — grey per bake goes 173 → 231 and ink
  drops 79% → 74%, because stroking feathers every edge on the creature. A local interior seam
  traded for a softer outline everywhere is the wrong trade for a pure-ink silhouette.
- **Seating the overlapping parts deeper.** No silhouette cost in principle, since a buried joint is
  interior, but it moves the geometry the facing read is carried by.

Shipped as the union alone, with the residue filed rather than guessed at.

### What the third reviewer said, verbatim

Given only the sheet and a neutral brief — no mention of a seam, a tail, or which frame to look at.
It corrected the brief's own claim that the sheet carries a tinted-background row; it does not.

> **A. Interior seam/hole in the "reach" (second) frame — present in 4 of 8 facings, absent in the
> other 4.** An automated scan for non-black pixels fully enclosed by black fill turned up exactly
> this cluster of defects and nothing else on the sheet, which lets me be confident this is the
> complete list:
>
> - **Panel 1 (contact grid), row 2 (reach), column 2** (a diagonal facing, head to the upper-left)
>   — a clean **white triangular notch** cut all the way through the silhouette, in the tail near
>   where it bends toward the trailing foot shape, roughly two-thirds of the way along the tail.
>   **Severity 4/5** — visible on a normal look at the panel, not just under zoom.
> - **Panel 1, row 2, column 3** (the facing with the head at top, body straight down) — the same
>   kind of clean white notch, at the lower-left where the front legs meet the torso. **Severity
>   4/5**.
> - **Panel 1, row 2, column 1** — a fainter grey smudge (not broken through to white) inside the
>   tail, same general area. **Severity 2/5** — needs a close look to catch.
> - **Panel 1, row 2, column 4** — a small grey sliver in the tail, similar to column 1. **Severity
>   2/5**.
> - **Panel 3 (magnified), right-hand box** (the reach frame) — the same defect as column 2 above,
>   shown at large scale: a diagonal streak of grey pixels running through the solid tail mass,
>   parallel to and just inside the tail's true edge. **Severity 3/5** in this panel alone —
>   noticeable on a careful look, not the first thing that jumps out.
> - **Panel 4 (flip strip)** — the same faint mark from column 1 recurs in every reach-frame
>   instance (3 of the 6 sprites in the strip). **Severity 1/5**.
>
> **B. Asymmetry between facings that should mirror each other.** […] column 4's tail is noticeably
> longer and more stretched-out than a flip of column 2 would produce, and column 8 is similarly
> more elongated than a flip of column 6. **Severity 2/5**.
>
> Distinct directions I could actually tell apart: […] about **5 of the 8** read as genuinely
> distinct. The other three (facings 6, 7, 8) collapse toward a single "compact blob with legs"
> silhouette.

### Where this reviewer is wrong, checked rather than argued

**There is no white notch, and nothing is cut through the silhouette.** The reviewer's own
instrument is the same one that failed here in round 2: a "fully enclosed by black" test cannot tell
an enclosed hole from a **concave pocket open to the background**, and a real gap between the tail
and a leg is the latter.

Checked with a flood fill from the image border, which is the test that distinguishes them: any
non-ink pixel the flood cannot reach is genuinely enclosed. Across the whole 1,800×1,392 sheet the
only enclosed regions are the four panel backgrounds and the counters of letters in the captions —
`e`, `a`, `o` and the like, 6×9 to 7×9 px each. **No sprite on either the before or the after sheet
contains an enclosed region.** The severity-4 finding is a real feature of the drawing described as
a defect.

One thing the flood fill does confirm: before the union there was a genuinely enclosed 8×8 block of
mid grey — one baked pixel at 8× magnification — inside the magnified reach frame. After the union
it is no longer enclosed. That single pixel is the seam the round-2 reviewer saw, and the automated
sweep that reported "23 pixels" missed it for the reason round 2 already recorded.

**The facing finding (5 of 8) is not disputed and is now third-reported.** It is the same finding
round 1 and round 2 raised, and it stays open — see below. The mirror asymmetry is real: the facings
are not mirrored, they are eight independent bearings through one plan, so a flip of one is not
expected to reproduce another.

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
