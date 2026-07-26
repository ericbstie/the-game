# generator — review

Box **75** (a 5×5 footprint at `TILE` 15), `facings: 1`, `frames: 1`. The generator has no states and
no animation, so both index axes are spent.

Reviewed per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md):
a separate subagent read `generator.sheet.png` each round and reported on it. Findings are advisory;
what was done with each is recorded here. Five rounds, and the subject changed twice.

## The lesson this sprite cost five rounds to learn

The generator is the **only building drawn flat, straight down** (#76 §2). The first four drafts were
flat *by construction* — no front face, no cast shadow, no light direction, no foreshortened ellipse,
no implied height — and reviewers confirmed the geometry was right every single time. Three of them
were still read as objects that stand up.

> **Projection is read semantically, not geometrically.**

Every one of those drafts was built around **a wheel seen face-on**, and a wheel is a thing everyone
knows faces sideways. Drawing one square to the viewer tells them they are looking at its front,
whatever the geometry says. Corner bolts compounded it: a bolt in each corner says "screwed to a
bulkhead", not "lying on the floor". No amount of correcting the projection fixes a subject that
carries its own orientation — the subject has to change.

## Round by round

### 1 — flywheel deck plate

A cast six-spoke flywheel on a riveted deck, four corner rivets, an all-over halftone.

**flat YES · 1930s ink NO · machinery "wrong machinery" · texture NO**

First glance, unprompted: **a computer case fan**, or a bathroom extractor vent.

| Finding | Done |
| --- | --- |
| Four independently fan-specific cues: rounded-square housing, four corner bosses reading as **mounting screw holes**, a full-field perforated screen reading as **grille mesh**, a hubbed rotor with radial spokes | Subject changed |
| **Zero hand variance** — mirror symmetry pixel-perfect, spokes at exactly 0/60/120°, each 4.6 px at every radius, contours constant the whole way round | Asymmetric layout; modulated contours |
| The halftone **was not a halftone**: 1 px square dots on a 2 px axis-aligned pitch, **39% coverage**, collapsing at real size into rows of broken dashes | Round dots, 45° lattice, about a fifth coverage |
| **42% pure black**, including one unbroken 45 px bar. This paints *under* the Y-sorted layer, so a 28 px player crossing it loses its silhouette | Open masses; ink now 35% of the box |
| The **opaque white field blanks the red ore** — a 75×75 white slab over the only red thing in the game | Deck no longer filled |
| Dots clipped **mid-dot**, leaving 1 px slivers and half-alpha crumbs | Dots withheld geometrically; none is ever cut |

### 2 — engine bed in plan

Subject changed. A crank running left to right puts everything on it broadside, so the flywheel
projects as a **bar** rather than a disc.

**flat YES · 1930s ink NO · machinery weak · texture NO**

The fan read died here and never came back. But: first glance **an instrument panel — a fuse box or
old radio front**. Stroke weight "close to uniform across the whole sprite". Halftone reduced to two
pockets. The five rivets were "essentially identical copies, and a smaller copy of the gauge — they
read as five tiny extra gauges".

Fixed before that round was even reviewed: each mass had been laying its own fat white clearance
stroke, which ate whatever it was mounted against — the cylinder erased its own head, the crank
erased the side of the dynamo.

### 3 — belt drive, rivets cut

Rivets cut entirely. Cylinder reproportioned from a near-square hollow rectangle to a long capsule.
Belt added down to a dynamo. Contours given a heavier lower edge.

**flat YES · 1930s ink NO · machinery NO · texture PARTIAL**

Two hard findings, one of them new and worse:

- The control-panel read persisted, **and it had grown a cartoon face** — cylinder and dial as two
  eyes, flywheel bar as a nose, the wide dynamo centred underneath as a mouth.
- The weight variation was **invisible even magnified**. It was real but far too small: 3.2 against
  4.2 and 5.0, differences under a pixel.
- "The belt is a straight hairline slot with no wrap or tension cue — it reads as a pipe or a seam."
  Correct, and unfixable: seen from directly above a belt genuinely has no wrap to show.

### 4 — pipework, ribs, and a real weight range

- **Face killed** by re-laying the masses as one asymmetric train along a single shaft, with nothing
  paired and nothing centred beneath.
- **Belt replaced by pipework** — a tube out of the cylinder, two elbows, an inline gauge, ending at
  a flange. A pipe is unmistakable from directly above and is what a plant is full of.
- **Dynamo given cooling ribs**, because without them it and the cylinder were two capsules of
  similar size that a reviewer paired off as matched panel furniture.
- **Weight range widened** from 2.4 to 6.0 px — two and a half times, rather than nominally varied.

**flat YES · 1930s ink YES (weakly) · machinery YES · texture MOSTLY · would ship**

> "The control-panel/fuse-box read is gone, and so is the cartoon-face read… I would ship this."

Read as "an engine or pump-and-gauge assembly"; the reviewer would not guess *generator* unprompted
but called it unambiguously functional industrial equipment. Line weight now reads as a real two-tier
system. No colour, no broken geometry, no fused joints, and no black mass big enough to swallow a
28–32 px character.

Its one requested change: **an isolated dot cluster below the gauge**, walled off from the rest of
the field, "a stray texture island rather than one continuous printed tone".

### 5 — the orphaned patch

The pipe run was carried down to the bottom of the deck so no sliver of deck is fenced off behind it.
That exposed a second, smaller instance of the same bug: the dot-exclusion boxes stopped at the
elbow, while the stroke's round join reaches half a bore further, so two stranded dots survived on
the outside of the bend. Both runs now extend a half-bore past the corner. The screen is one
contiguous field.

## Standing notes, carried unresolved

- **It reads as an engine assembly rather than specifically a generator.** Accepted. Nothing in the
  set is labelled, ADR 0001 forbids text in the world, and this is the only 5×5 building on the field
  — there is nothing for it to be confused with.
- **1930s ink is a "weak yes".** The thick/thin contrast is real but the corners are still cleaner
  than hand-inked line. Left as it is: this is the largest sprite in the set and it paints under
  everything, so legibility beat looseness.

## Choices the contract left open

- **`facings: 1`** — the contract says "your call". A building has no facing and this one has no
  states, so there is nothing for the variant axis to carry.
- **Fills the box edge to edge**, as the contract requires of a flat sprite, so the harness's
  "touches the edge of its box" warning fires and is correct here. The box *is* the 5×5 footprint.
- **The deck interior is transparent.** Nothing in the contract asked for this; round 1's finding
  about blanking the ore did.
- **Checked at `--dpr 1` as well as 2.** An early draft's 1 px inner line was centred on a whole
  coordinate, so it straddled two rows and baked as two half-covered greys — a ghost of a line. Ink
  went from 36% to 42% of covered pixels at dpr 1 on that one fix.
