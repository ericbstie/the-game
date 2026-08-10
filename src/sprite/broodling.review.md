# broodling — blind review

Per ADR 0002. The reviewer was given only `broodling.sheet.png` and a neutral brief, and was never
told what the creature is, what it is called, that it is new, or what it is meant to convey. Its
answers are reproduced **verbatim**, including the findings the implementer disagrees with and the
one that measurement refutes.

---

## The review, blind

> ## 1. What is this a picture of?
>
> A small, roughly egg/pear-shaped blob creature with a lumpy black silhouette, a fat rounded head-body fused into one mass, two or three stubby leg-nubs underneath, and one pale unfilled circle (like an eye or a bubble/claw) poking out on its right side. My best reading: a squat little monster or larva — something between a spider and a crab, or possibly a single bulbous "grub" with one visible eye. Second reading: it could be read as a lumpy paw/mitten shape if you didn't know it was a creature — the black mass with one white circle and a scatter of finger-like points below doesn't unambiguously read as "animal" without context.
>
> ## 2. Build
>
> It's a single fused blob — there's no separable head, neck, thorax, or abdomen; the "head" is just the top of the same mass as the "body." It sits low and wide, wider than it is tall, like it's hunched or squatting rather than standing. Underneath there are 2–4 short pointed nubs that read as legs, splayed unevenly, not obviously paired left-right. One pale circular void sits on the right side, roughly mid-height — the only "feature" breaking up the solid black mass. There's no visible tail, no arms distinct from legs, no neck at all — it's a single hunched lump with feelers or feet jutting out the bottom.
>
> ## 3. Young/old, weak/dangerous
>
> Reads as young and weak, not old or dangerous. The rounded, doughy, proportion-heavy-on-top silhouette with tiny scrabbling legs underneath is a classic "hatchling/larva" shape — nothing here suggests armor, horns, claws, or aggressive posture. The one visible circle reads more like a single soft eye than a weapon or plate. It looks squishable, not threatening.
>
> ## 4. The poses
>
> Looking at the contact grid (row 1, 8 facings): they do NOT clearly read as 8 distinct compass directions. Several adjacent frames are nearly identical blobs with only the pale-circle position shifting slightly and the leg-nub angles wobbling — the silhouette itself doesn't rotate in any way that's legible as "facing." Frame 1 and frame 5, for instance, look like near-mirrors of each other rather than opposite-facing readable poses; frames 2–4 collapse into very similar "blob with circle on the right" shapes. I cannot confidently say which specific compass direction any single frame is facing — there's no snout, no directional limb pair, nothing that anchors "this is front" vs "this is side." At most I can tell the pale circle migrates around the silhouette from frame to frame, which is the only real signal of "facing" here, and it's a weak one.
>
> ## 5. Hand-drawn or machine-generated?
>
> This reads as machine-generated/procedural, not hand-inked, and it's a real problem given the stated art direction. Specifically:
>
> - The magnified panel (row 3) shows the outline is built from small uniform blocky pixel steps with a **soft, almost anti-aliased gray gradient** fringing the black edge — that gray-scale feathering is a digital/procedural rendering artifact, not something a hand-inked comic line does. A real inked line is either black or white with a hard, deliberate edge (or at worst a single-pixel jaggy stairstep at true size); this has a multi-step gray ramp around the entire silhouette, which reads as antialiasing/blur left on, or a soft-brush stamp — not pen and ink.
> - The white circle "eye" is a perfectly round, perfectly smooth ellipse with a soft gray halo — too geometrically regular and too evenly gradient-ringed to be hand-drawn; it looks like a stamped/vector circle composited on top of a noisy blob rather than an inked feature.
> - The body silhouette itself has no confident linework at all — no contour line, no crosshatching, no varying line weight (thick where the pen pressed, thin where it lifted), which is the main visual signature of "hand-inked comic" style. It's just a solid filled blob with an irregular but fairly uniform-density bumpy edge, closer to a noise-displaced circle than a drawn creature.
> - The bumps around the edge (the "legs"/points) look randomly distributed rather than composed — they don't correspond to anatomy (no left/right symmetry, no consistent count across frames), which is the signature of procedural jitter/displacement rather than a hand choosing where a leg goes.
>
> ## 6. At true size (small panel)
>
> At true size it barely survives as "a dark blob." You can tell it's roughly oval/lumpy and slightly wider than tall, but the pale circle is barely a pixel or two and mostly disappears into gray noise; the leg nubs are indistinguishable smudges. There is no legible face — the one pale circle that might read as an eye at magnification is just a faint gray fleck at true size, easily missed entirely. It reads as "a dark bug-shaped speck," nothing more specific.
>
> ## 7. Craft problems
>
> - **Gray antialiasing halo** around the entire silhouette in the magnified view — this is the biggest tell of a modern digital effect; it looks soft/blurred rather than being crisp black-on-white the way an inked-and-printed comic panel would be, even accounting for pixel-grid stairstepping.
> - **The white circle** is suspiciously smooth and perfectly round with its own soft gray ring — reads as a punched hole / vector shape floating on the blob rather than an inked highlight or eye.
> - **No internal linework** — the whole creature is a flat silhouette with zero interior detail (no ink lines, no hatching, no highlight strokes), which will read as a generic inkblot rather than a drawn character, especially next to anything in the game that does have inked linework.
> - **Inconsistent/asymmetric leg nubs** — they don't repeat in count or placement across facings in a way that suggests intentional anatomy; several frames show 2 legs, others show what could be 3, with no clear rule.
> - **Facing frames collapse into each other** (see Q4) — several poses are near-duplicates, which will read as jitter/idle-wobble rather than deliberate directional animation.
>
> ## 8. Many on screen next to a larger creature
>
> Noise. At true size the creature is already just a dark smudge with a faint gray fleck; with no crisp silhouette, no strong readable feature, and edges that go soft-gray rather than hard black, a cluster of these next to a bigger, presumably better-defined creature will visually smear into a fuzzy dark mass rather than register as "several small individual things." The lack of any distinguishing per-pose silhouette (Q4) makes it worse — even a single one in motion will look like it's just twitching in place rather than moving with direction.

---

## What was checked, and what it changed

**The brief succeeded on the one thing it was for.** Told nothing, the reviewer read the creature as
"a squat little monster or larva" that is "young and weak… squishable, not threatening". That is the
whole of what #138 asks a broodling to say.

### The headline craft finding is refuted by measurement, and is kept anyway

The review's biggest complaint — the grey fringe as "the biggest tell of a modern digital effect" —
describes ordinary canvas rasterisation, which every sprite in this game has. Measured as ink over
covered pixels at dpr 2, through the shipped harness:

| sprite | ink as a share of covered pixels |
| --- | ---: |
| **broodling** | **62%** |
| grunt (shipped) | 59% |
| bloodling (shipped) | 31% |

The broodling is *crisper* than both creatures already in the game. A reviewer shown one sprite and
no others cannot know that, and the finding is honest from where it stands — it is recorded rather
than deleted, with the number beside it. The same answer covers "no internal linework": the game's
creatures are solid ink silhouettes with paper cut out of them, and that is the style, not a lapse.

### Two findings stand, and both were independently flagged by the artist

**The rear facings collapse.** The reviewer could not tell several poses apart; the artist wrote,
without having seen the review, that "facings 5, 6 and 7 are separated by the leg fan alone" because
the head is genuinely hidden behind the abdomen from behind. Two independent observations of the
same thing make it real rather than arguable. Left as drawn — it is what the animal would do, and
it is what `bloodling` already does with its sack — but it is the first thing to revisit.

**The face does not survive dpr 1.** The reviewer found "no legible face" at true size; the artist
had already flagged that each eye is about two logical pixels at 1× and rasterises mostly grey. Both
are right. The README has already measured and rejected the thresholding tricks that would chase it,
and the box cannot afford larger eyes without eroding the head's contour.

### The finding that matters most is not settled here

"Several on screen next to a larger creature reads as noise" goes straight at what a broodling is
for — they arrive three at a time, beside the Broodlord that bore them. A sheet cannot answer it.
The ticket's own verification asks for a rendered frame at `ENEMY_CAP` with both kinds present, and
that is where this gets judged.

Every number in the sprite is provisional. Three of these on screen beside a Broodlord in a played
match is the only test that counts.
