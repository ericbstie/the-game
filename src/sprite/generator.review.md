# generator — review

Box **75** (a 5×5 footprint at `TILE` 15), `facings: 1`, `frames: 1`. One variant: the generator has
no states and no animation, so both index axes are spent.

Reviewed per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)
— a separate subagent read `generator.sheet.png` and reported on it. Findings are advisory; what was
done with each is recorded below.

## The constraint that drove every round

The generator is the **only building drawn flat, straight down** (#76 §2). Miner, wall and turret
are elevation and stand up into the Y-sorted layer; this one paints underneath it with the floor and
the ore. Three drafts failed the same way, and the reason is worth writing down because it is not
obvious:

> **Projection is read semantically, not geometrically.**

All three drafts were flat *by construction* — no front face, no cast shadow, no light direction, no
foreshortened ellipse, no implied height. Reviewers confirmed the geometry was correct every time.
They still read the sprite as standing up, because every draft was built around **a wheel seen
face-on**, and a wheel is a thing everyone knows faces sideways. Drawing one square to the viewer
tells them they are looking at its front, whatever the geometry says. Corner bolts compounded it: a
bolt in each corner says "screwed to a bulkhead", not "lying on the floor".

## Round 1 — the flywheel deck

A cast six-spoke flywheel on a riveted deck plate, four corner rivets, an all-over halftone.

**Verdict: flat YES, 1930s ink NO, machinery "yes, but the wrong machinery", texture NO.**

First glance, unprompted: **a computer case fan** — or a bathroom extractor vent. Not a power plant.
"Power plant" and "1930s" never occurred to it.

| # | Finding | Done |
| --- | --- | --- |
| 1 | Four cues each individually fan-specific: rounded-square housing, four corner bosses reading as **mounting screw holes**, a full-field perforated screen reading as **grille mesh**, and a hubbed rotor with radial spokes. No second read available. | Subject changed entirely — see round 2 |
| 2 | **Zero hand variance.** Left–right mirror symmetry pixel-perfect; spokes at exactly 0/60/120/…°, each 4.6 px wide at every radius; outer contour 3.5 px and inner 1.0 px, both constant the whole way round. Reads as a vector icon. | Composition is now asymmetric throughout; contours take a heavier second pass over the belly of each run |
| 3 | **The halftone was not a halftone** — 1 px square dots on a 2 px axis-aligned pitch, **39% coverage**. Collapsed at real size into rows of broken dashes with a diagonal shimmer, and sat below the frequency any display can hold. | Round dots, 45° lattice, 6 px pitch, ~14% coverage |
| 4 | **42% pure black**, with a single unbroken 45 px black bar through the middle. This paints *under* the depth-sorted layer, so a 28 px player crossing it loses its silhouette. | Machine masses are white with ink contours; deck is open |
| 5 | The **opaque white field blanks the red ore** — a 75×75 white slab over the only red thing in the game. Black ink on white holds fine; the white was the problem. | Deck is no longer filled: ore glows up through the screen |
| 6 | Dot grid clipped **mid-dot** against the rim, leaving 1 px black slivers separated by a 1 px white gap — a doubled contour, plus grey fringe and half-alpha crumbs at the deck boundary. | Dots are placed by a containment test and withheld near linework, so no dot is ever cut |
| 7 | Dot field not centred in its deck — 3.5 px top margin against 1.5 px bottom. The only asymmetry in the sprite, and the wrong kind. | Field derives from the deck box |

Colour was clean in every round: zero non-grey pixels across the whole sheet.

## Round 2 — the engine bed in plan

The subject changed rather than the execution. A crank runs left to right, which puts everything
mounted on it broadside to the viewer, so the flywheel projects as a **bar seen edge-on** rather than
a disc — and so do the cylinder and the dynamo. The only true circles left are the things whose axes
really do point up out of the deck: the rivet heads and the gauge. That internal consistency is the
argument that this is a plan view, and it also buys back what the earlier drafts never had — a
reason to believe the thing makes power.

Left to right: cylinder head, cylinder, crank, flywheel edge-on, drive shaft, dynamo. A gauge sits
bottom-left and a terminal strip bottom-right. Four rivets along the top against two along the
bottom, unevenly spaced.

Two defects were caught and fixed before this round was reviewed:

- Each mass had been laying its own fat white clearance stroke, which ate whatever it was mounted
  against — the cylinder erased its own head, the crank erased the side of the dynamo. Clearance is
  now withheld from the screen geometrically instead of painted over the drawing.
- The wheel, dynamo and terminal strip were colliding and tangent. Re-laid with real gaps, and the
  shaft boss was cut rather than crowded in.

REVIEW_ROUND_TWO

## Choices this sprite made that the contract left open

- **`facings: 1`.** The contract says "your call". A building has no facing and the generator has no
  states, so there is nothing for the variant axis to carry.
- **It fills the box edge to edge**, as the contract requires of a flat sprite — so the harness's
  "touches the edge of its box" warning fires, and is correct here. The box *is* the 5×5 footprint.
- **The deck interior is transparent.** Nothing in the contract demanded this; the round-1 reviewer's
  finding about blanking the ore did.
- **Checked at `--dpr 1` as well as 2.** An early draft's 1 px inner line was centred on a whole
  coordinate, so it straddled two rows and baked as two half-covered greys — a ghost of a line.
  Straight runs now sit on whole pixels at both densities; ink went from 36% to 42% of covered
  pixels at dpr 1 on that fix alone.
