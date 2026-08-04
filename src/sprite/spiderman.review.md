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

**Superseded by "Round 4" below: the fit scale this section describes is gone, and every geometry
number in it now describes a drawing that is no longer shipped.** The section is left as written —
it is the record of what was measured and decided at the time, and its closing paragraph called the
outcome correctly.

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

## Round 4 — the doubt was right, and the creature was re-cut at full size (#173)

**This supersedes the geometry in "What changed between the two reviews" and the coverage numbers in
"The finding this ships with open".** The fit scale is gone. Its cost was not a suspicion in the end;
it was measured, and it was worse than "a quarter smaller".

**What the doubt turned out to be.** A blind reader was shown `sprite:frame --zoom 0.5 --enemies
500` and asked one question — how many visually distinct kinds of creature it could count. It
answered **three**, and the spiderman was not one of them. Its counts for the other three landed
inside their true ranges (elite ~99, grunt 312, bloodling ~57; spidermen 31, and absent). Blit
counts confirmed the spidermen were drawn. They were being read as grunts.

**Why the scale did more damage than its size suggests.** `FIT` multiplied *positions* and spared
*widths* — the stroke tables and the two lobe width tables — which was the right instinct about
stroke weight and the wrong one about the body. Scaling one and not the other does not shrink a
shape, it **reproportions** it. The abdomen went from 10.4 long by 9.6 wide to 7.9 by 9.6 and the
head end from 8.6 by 6.2 to 6.5 by 6.2: both lobes ended up wider than they were long. Round 1's
reader called the result *"a solid black, amorphous blob"* and was describing exactly that, one
version before the scale was even applied to make it worse.

**What replaced it.** Positions are written at the size they render at. The box is fitted by the two
things that actually set the width in the flat facings — the arms' forward reach and the abdomen
tip's trail — and the mass was moved into the abdomen, which is nearly free horizontally because a
lobe's fat middle sits inboard of its own tip.

**Measured, all 16 bakes at dpr 2, before → after:**

| | before | after | grunt |
| --- | --- | --- | --- |
| coverage, device px | 32–51 × 28–40 | 34–58 × 33–47 | 45–55 × 37–44 |
| covered px per bake | 730 | 958 | 919 |
| ink, all bakes | 9,271 | 12,491 | 8,623 |
| ink as a share of covered | 79% | 81% | 59% |
| tightest margin, horizontal | 1 | **2** | 3 |
| tightest margin, vertical | 11 | **4** | 2 |

No bake touches its box, which was the ticket's first check. The creature now covers slightly more
of its box than a grunt covers of its own, and carries **45% more ink** — at dpr 1, where the
separation matters most, its ink share is 62.6% against the grunt's 32.6%.

**One thing was found and fixed inside this change, and it is worth recording because it nearly
shipped.** The first pass put the recovered size into *both* lobes and grew the head end to 7.8
wide. That buried the two grappling arms inside the body mass — the one mark that names this
creature stopped appearing in the silhouette at all, and the sheet went back to a bigger version of
the same blob. The head end has to stay small and low, and the arm arch has to clear it. That is now
a stated constraint in the source rather than an accident of the numbers.

**What is not claimed.** A comment on #173 asks whether the re-cut should be judged against the
**elite** as well as the grunt, noting that the two pull opposite ways — separating from the grunt
wants more ink, separating from the elite wants less. The author has not taken a position and this
change does not settle it. It was composed against the grunt, which is what the ask and the sprite's
own header name.

**What the author is unsure of.** The two arms do not read as *two* at real size. `PLAN` is 0.46, so
`ARM_SPREAD`'s 24 degrees survives as about a pixel of screen separation, and the pair closes into
one forward mass with two hooks on its tip — the white counter between them, which the source
claimed as "the one counter in this silhouette", is not there at 32 px. What reads is the mass and
the hooks. The claim has been corrected in the source rather than left standing.

The facing finding from rounds 1–3 was not addressed here and stays **open**. Nothing in this change
was aimed at it.

### Round 4's two blind reads, verbatim

Two readers, each given an image and a neutral brief and nothing else. Neither was told a change had
been made, what it was meant to achieve, or that a spiderman existed.

#### The played frame — the read the ticket asked for

`sprite:frame --zoom 0.5 --enemies 500`, one question: *how many visually distinct kinds of creature
can you count, and roughly how many of each.* The same brief that produced the verdict this re-cut
answers.

It named four kinds. **The spiderman was again not one of them** — its four were the elite ("a large,
heavy, solid-black round/oval mass… two white oval eyes", 100–130 against a true 100), the grunt ("a
much smaller body with 6–8 very long, thin legs radiating outward in a star/asterisk pattern",
350–450 against a true 312), the bloodling ("a bright-green upper cap and dark-violet lower cap",
40–50 against a true 57), and a one-off it could not place.

But it did not miss the creature this time. Under *what it could not classify*, unprompted:

> a compact, rounder, mostly-legless black blob appears repeatedly (e.g. 865,170–915,215;
> 1070,240–1120,285; 85,585–120,615) — smaller and stubbier than Kind B's "starburst" pose but
> matching its core body size and its total lack of facial markings. I read this as **Kind B in a
> different leg/gait pose** (medium-high confidence, not certain) rather than a fifth kind

**All three of those positions are spidermen.** Checked rather than assumed: the identical scene was
re-rendered with the spiderman module swapped for one that draws nothing (`--sprite
spiderman=<blank>`), and the two frames diffed. The changed pixels cluster at, among others, x
884–900 y 181–197, x 1086–1151 y 254–278, and x 88–106 y 592–612 — the reader's three examples. Its
one-off fourth kind is **not** a spiderman; no cluster falls within 100 px of it.

So the creature went from **absent** to **seen repeatedly, described accurately, and offered as a
candidate kind before being resolved into the grunt with the reader's own uncertainty attached**.
That is a real move and it is not the finish. It ships as an open finding.

The reader's stated grounds for merging it — *"matching its core body size"* — is the one part that
does not survive checking. At 7× on the played frame the spiderman is a closed solid mass on stubby
legs and the grunt is an open radiating star around a dot several times smaller; the masses are not
comparable. What the same crop does show is that the live confusion risk points at the **elite**,
which is also a closed solid mass — larger, and with eyes. That is evidence on #173's open elite
question and deliberately not an answer to it.

#### The sheet — ADR 0002's four checks

> **What is it.** A blobby, faceless arthropod — a large teardrop/oval mass (abdomen) fused to a
> smaller lobe from which 3–4 thin, tapering rubber-hose legs radiate downward… If I had to name it:
> a spider or tick — an insectoid grunt, not a humanoid.
>
> **1930s NYC ink-cartoon style.** Partially. What matches: pure black silhouette on white, zero
> gradient fills, no colour, and the legs have genuine rubber-hose taper with soft rounded joints.
> What breaks it: (a) no face — every Fleischer/early-Disney-era character, however monstrous, gets
> legible eyes; this is an anonymous mass, unreadable as a "character." (b) The edges are not hard
> ink lines — every silhouette has a soft anti-aliased grey halo 2–4px wide.
>
> **Artefacts.** […] Three genuine enclosed holes survived the check […] all three sit in the same
> body location (the leg/mouth junction) and all three are in frame 2 only — never frame 1, and
> never in the other five facings. That reads as one systematic gap in whatever draw step renders
> that joint for frame 2, not three random glitches. No stray marks exist anywhere else on the
> sheet.
>
> **Cut off at tile edge?** No, checked two ways. […] the smallest gap across all 16 sprites is
> 38px, none near zero or negative — no evidence of clipping anywhere.
>
> **Frame consistency and motion.** Reads as one creature in two poses. Diffing facing-1 frame1 vs
> frame2 (aligned masks): 1081 of 12,350 pixels differ (8.8%), and 860 of those (80%) are in the leg
> region vs. only 172 in the head/body region […] consistent with a weight-shift/settle on a step.
> This is a coherent, natural-reading walk cycle, not an identity break.
>
> **Facings.** […] **6 of 8** carry a legible bearing; the other 2 are visually distinct from all the
> rest but don't commit to a direction.
>
> **Colour.** None. Exhaustive scan of all 2,505,600 pixels found 256 distinct colours, every one
> with R=G=B.

It also read the caption and set it aside without being asked to: *"The sheet's own caption calls the
file 'spiderman,' but nothing drawn supports a humanoid reading; that label is the filename trap the
brief warned about."* Rounds 1 and 2 needed telling.

### The holes are real, and the re-cut made them smaller rather than larger

Checked before recording, because a reported hole and a concave pocket open to the background look
identical in a crop, and round 3's reviewer got exactly this wrong. A flood fill from the image
border was run on both the shipped sheet and the one on `main`, at three thresholds.

**The reviewer is right.** All three of its holes reproduce, to the pixel and to the peak brightness
it quoted — 17 px at x 254–258 (peak 121), 18 px at x 363–366 (peak 143), 11 px at x 780–782 (peak
69). At the contact grid's magnification those are one to two baked device pixels each at dpr 2.

The comparison that decides whether this change caused them:

| enclosed in-sprite pockets, flood fill from the border | before | after |
| --- | --- | --- |
| contact grid, the same two facings | **87 px and 85 px, peak 255** | 18 px and 17 px, peak 143 / 121 |
| magnified panel | 448 px, peak 169 | 64 px, peak 60 |
| flip strip | 3 × 31 px, peak 123 | none |

The two pure-white holes are gone, the magnified panel's pocket is down to a single baked pixel of
dark grey, and the flip strip is clean. This is the residue #178 is open on, in the same class and
materially reduced — and the re-cut was not aimed at it, so the improvement is a side effect and not
a fix. **What the reviewer adds that #178 does not have is where it is**: the leg/head junction, in
the reach frame only. #178 assumes the tail, from #171's diagnosis. The border flood fill is also the
instrument #178 says does not exist — it locates the residue without moving the bake's box.

### The author's call

Ships, per ADR 0002 §3. The ticket's first check holds — no bake touches its box — and the second,
the look at it beside a grunt in a played frame, is what this section records.

**Two findings ship open, and neither is closed by this change:**

- **The creature still resolves into the grunt population for a blind reader.** It is now visible and
  correctly described where before it was not seen at all; it is not yet counted as its own kind.
- **The facings.** Rounds 1–3 read 3 of 8, then 5, then 5. Round 4 reads **6 of 8**. That is a
  different reader with a different instrument, so it is recorded as a fourth data point and not as a
  finding closed.

One thing this change is measurably worse at, and it is not in either read: `LUNGE` is the only
motion constant that shrank in rendered terms, 1.14 to 0.6 — the width it bought is what let the
reach frame fit the box. The sheet reviewer judged the two frames a coherent walk cycle anyway, but
it never saw the old one.
