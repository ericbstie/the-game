# `ammo` — review notes

The sprite is `src/sprite/ammo.ts`; the sheet is `src/sprite/ammo.sheet.png`. Reviews are advisory
([ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)), so this
records what was said, what was done about it, and what was deliberately not done.

The HUD's squad-ammunition icon, for the counter [#102](https://github.com/ericbstie/the-game/issues/102)
stage 3 puts above the Energy readout: "a square with an ammo icon". It stands for the shared pool a
player's shot and a turret's shot both draw from. Like `warning` and `reconnecting` it lives in the
HUD, not the world, so `drawWorld` never sees it and it reaches the screen through `SpriteIcon`.

## The calls

`README.md` has no row for this sprite at all, so every choice below was open.

| Call | Chosen | Why |
| --- | --- | --- |
| Name | **`ammo`** | Added to `SpriteName` by the integrator. |
| Box | **28** | The box `warning` and `reconnecting` draw in. It is blitted at ~26 px next to them, and a mismatch between three icons in the same HUD would read as a mistake. The box is also not the lever it looks like: `SpriteIcon` scales box to px, so what sets the icon's apparent size is the share of the box the drawing fills — which is what round 4 finally spent, going from 13 units of width to 24. |
| `facings` / `frames` | **1 / 1** | One state, and no flash. `warning` and `reconnecting` blink because they report a *condition*; a counter reports a *value* and has nothing to blink about. |
| Subject | **Cartridges, whole and unfired — three of them** | A round is the thing being counted, and it names no weapon and no shooter, which matters because the pool is shared between the player's gun and a turret's. Six bakes of a *single* round were cold-read as six different lone objects and never as ammunition; round 4 drew three and the cold read landed first time. |

A drawn object rather than a mark, for the reason `warning.ts` sets out: ADR 0001 took text out of
the game thoroughly enough that a letterform or a punctuation glyph smuggled back in as an icon
would be the same habit wearing a hat.

## What kept going wrong

**Every obvious way to draw *one* cartridge at 26 px lands on a pedestal.** A dome over a stem over
a wide foot is a chess pawn, and the reviewer named it cold, before being told what the sprite was
meant to be. Six bakes went to escaping it and none of them did. That is the useful output of this
file — and the eventual answer was that the problem was the word *one*, not the drawing:

1. **A gentle taper is a cone, not a cartridge.** Bake 1 ran one continuous outline from a rimmed
   base to an ogive with a soft shoulder between them. The outline never stopped narrowing, so
   there was no event in it — it read as a fin.
2. **Two stacked masses are a chess piece.** Bake 2 floated the bullet clear of the case on a band
   of bare paper, on the theory that the case-mouth gap is the standard ammo-icon cue. It is also
   the grammar of a pawn — head, collar, body, plinth — and that is what the reviewer saw.
3. **There is no line thin enough to score a seam without severing it.** Bake 3 replaced the gap
   with a scored white mouth line a third the width. It cut the bullet clean off just the same.
   A horizontal band across the case mouth cuts the form at its weakest point.
4. **Rotating 28 px art destroys the feature it is meant to save.** Bake 3 was also tilted, which is
   the conventional cure for the pawn reading. The shoulder notch survived on one flank only and the
   whole thing came back as a lump. Symmetry is what makes a 2 px notch legible.
5. **Drawing the lean natively fixes the notch and still loses the icon.** Bake 6 built the round at
   the angle point by point — no transform over finished art — and stepped the shoulder by a
   different amount on each flank so both notches came out at the same shallow angle. The notch did
   survive on both flanks at dpr 2, exactly as predicted. The cold read still went backwards, from
   *cartridge second* to *cartridge fourth, and only by reaching*. Round 3 has the measurements.
   **The round stands plumb, and that is settled.**

6. **A lone tapered cylinder has nothing left to spend on saying *which* cylinder.** Bakes 1–6 were
   all one round, and their six cold reads were rocket, lighthouse, obelisk, pawn, headstone and
   hooded figure — six things that stand alone. Bake 7 draws **three**, and the first cold read of it
   was *three bullets*, immediately. Repetition is the feature a single silhouette could not afford:
   there is no lighthouse that comes in threes.

The sprite that ships is bake 7: **three cartridges in a row**, each one continuous silhouette with a
bottleneck in it, standing plumb, with no interior marks. The shoulder is a hard horizontal ledge on
an integer row; above it the neck and the bullet's shank are one unbroken parallel-sided column,
longer than the ogive that caps it; below it the case is straight-sided to a flat base, with no rim.
Round 4 has the geometry and the numbers.

## Round 1 — bake 2, the floated bullet

**Found.** Cold read at real size: **a chess pawn.** Second read, a tombstone or a small table lamp.
"Cartridge" was not in the reviewer's first three guesses at either density. Knowing what it was
meant to be only partly changed it — "the read does not lock in, the eye keeps sliding back to
pawn/finial".

- **The white gap between bullet and case was doing more damage than everything else combined.** A
  cartridge is *one* silhouette; two disconnected masses is the grammar of a chess piece.
- **The rim overhung the case by ~2 px per side and stood ~3 px tall** — "that is not an extractor
  rim, that is a pedestal foot", and it was the widest, heaviest element in the drawing.
- **The exposed bullet was as long as the whole case**, so the top mass read as balanced on the
  lower one rather than seated into it.
- **Style: a flat black silhouette with no contour, no linework and no interior white.** "Nothing
  here would look out of place in a 2015 Material Design icon set."
- **The case had hard square 90° corners**, the most anti-rubber-hose primitive available, and the
  mismatch with the curved ogive above reinforced the two-objects reading.
- **The two densities read as different drawings**: at dpr 2 two clearly separated objects, at dpr 1
  the gap filled with grey and fused them into a blob. The reviewer called that inconsistency a
  defect in its own right.
- Colour clean. No generated-imagery artefacts of any kind at either density.

**Done.** Rebuilt rather than patched — the gap removed, the rim thinned, the bullet shortened
against the case, the corners rounded by stroking the fill. The tilt was tried, as suggested, and
reverted (bake 4); the scored mouth line was tried and reverted (bake 3).

## Round 2 — bake 4, the continuous bottleneck

**Found.** "Clearly better, and the gap fix worked." Cold read now: **a rocket or missile, then a
bullet or cartridge, then a lighthouse or obelisk.** Cartridge in the top two, where it had not been
in the top three. Pawn and tombstone both gone. What remained was the lighthouse/rocket family —
"you have moved from *wrong object class* to *right class, ambiguous member*" — caused by the plumb
stance plus a flared foot plus a long tapering point.

Closed from round 1: the gap; the rim overhang (now ~1 px per side, no longer the heaviest element);
the bullet-to-case ratio, now correctly inverted; the square corners; and the two-density
inconsistency — "dpr 1 is now just a softer version of dpr 2".

- **The shoulder registers as a width change, not as a notch.** The step size is fine — ~7 px neck
  against ~11 px case, 2 px per side — but there was **no straight-sided neck above it**, so the
  form went from the step straight into a taper toward the point. "That reads as the base of a spire
  widening out, which is the lighthouse cue." Named the highest-value remaining change, and a
  silhouette edit rather than a contrast one, so it does not hit the severing problem.
- **The nose is too long and too pointed for a bullet** — ~40% of total height, where real rounds,
  pistol rounds especially, are stubby. "Differently bad" than round 1's wide dome, and the new
  load-bearing weakness.
- **On the tilt: right call, given what was seen** — a tilt surviving on one flank trades away the
  only feature carrying the read. But the reviewer was clear that *rotating* 28 px art is what
  destroyed the notch, not tilting as an idea, and that a version drawn **at** the angle with the
  shoulder stepped deliberately on both flanks is a different proposition, worth one attempt.
- **The style finding was not addressed at all and is unchanged from round 1.** Still a bare flat
  black silhouette; the case body is ~12 px of solid black carrying zero information and is the
  largest area of the sprite. Suggested two placements that cannot sever the form by construction: a
  vertical white highlight sliver down one side of the bullet and neck, or an asymmetric white bite
  out of one side edge only. The vertical highlight is "the standard rubber-hose move".
- Artefacts: none at either density. Symmetric to within a fraction of a pixel at dpr 2. Regular
  stair-stepping on the ogive flanks and a ~1.5 px flat cap at the apex; ~1 px grey halo and a
  partly-grey shoulder step at dpr 1. All filed as pixel budget, not defects.
- Colour clean at both densities.
- **Aspect ratio flagged as a trade, not a defect**, and explicitly left to the author: ~13×24 is
  chunky where a real cartridge is nearer 0.3; slimming it would say "cartridge" harder but costs
  mass at 26 px.

**Done.** The parallel-sided neck lengthened from 3.8 to 5.2 units and the ogive cut from 4.9 to 3.9,
which addresses both the missing neck and the over-long point with one edit. The case gained the
length the nose lost.

## Round 3 — bake 6, the round drawn leaning, and why it is not the one that ships

Round 2 left the redrawn-at-angle tilt as the one open item, and a code review sent the sprite back
for it: every other icon on this HUD plate uses tilt or asymmetry as its anti-glyph signature —
`warning.ts` at `TILT = -0.11`, `reconnecting.ts` on a diagonal, `unpowered.ts` at `TILT = 0.09` with
*"no hand strikes a bolt plumb, and a plumb one is a glyph"* — and ammo was the only one standing
plumb and bilaterally symmetric. Two conditions came with it: build the geometry **at** the angle
rather than rotating finished art, and **step the shoulder deliberately on both flanks**.

**Built.** Bake 6 laid the round out in its own frame — `u` across, `v` up the axis from the case
head — and placed every vertex and every Bézier control into the box already leaning, so the notch
was cut against the pixel grid it would be rasterised on. `TILT = 0.12` rad. The shoulder reached
full case width lower on the left flank than on the right (1.25 against 0.5 units), chosen so that
once the lean had swung them, both notches met the case wall at the same shallow angle instead of one
ledge and one taper. The step was widened to 2.9 units per flank and the rim to a unit proud.

**Found.** A fresh reviewer, given both densities and asked for a cold read before anything else.

- **Cold read at real size: (1) a hooded or cloaked figure seen head-on** — "a monk, a Grim Reaper, a
  cowled cultist. Dome-head on broad shoulders on a skirted base, one solid black mass, no face …
  immediate and unambiguous", high confidence, from panel 2. **(2) a gravestone or headstone** —
  "round-topped slab on a plinth, leaning in soft ground", medium-high, also panel 2. **(3) a chess
  pawn, or a bag with a cinched neck** — "dome, collar, body, foot", medium, from panel 3, and it
  noted the pawn reading gets *stronger* under magnification, not weaker.
- **It declared the filename.** "ammo" is in the sheet header and it read the word first. Knowing
  that, it could construct a cartridge — "but it was a fourth reading I had to *reach* for, not one
  that arrived. Without the word, 'cartridge' would not have been in my top three from panel 2."
- On this file's claim that the pawn was fixed: **"It was not fixed. It was re-derived with a
  continuous outline instead of a detached one. Two masses joined by a step are still two masses."**
- **The lean reads as a mistake.** "Too small to be a gesture and too large to be plumb … the eye's
  reading is not *this round is lying at an angle* but *this thing is standing up crooked*. It looks
  like a rasterisation error or a sloppy transform, which is the one thing it must not look like."
  And it makes the wrong object stronger: "a **leaning headstone** is not a defeated obelisk, it is a
  stronger and more specific object than the one you were trying to kill. Guess 2 in my cold read
  exists *because* of the lean." Its verdict: commit to 20–35° where a round genuinely reads as lying
  down, or set it to zero and find the non-glyph gesture "in the silhouette, not in a transform".
- **The shoulder, dpr 2: present on both flanks, and staggered.** Left 3 CSS px of step over 1 of
  height, right 2.5 over 0.5 — "also a real corner". The per-flank compensation did what it was
  built to do; the reviewer measured both notches at ~16.5° from horizontal, "genuinely matched". But
  **matching the angles did not match the heights**: the left completes ~0.6 CSS px above the right,
  "one shoulder visibly higher than the other: a shrug, not a case mouth. That asymmetry is exactly
  what pushes the read toward *figure* and away from *object*."
- **The shoulder, dpr 1: neither flank delivers.** Left "reads as a 45° chamfer, not a step — if I
  did not know a step was supposed to be there I would call it a corner being rounded off." Right:
  "gone … the shape simply gets wider." **"The feature the design depends on is a retina-only
  feature."**
- **The base breaks at two heights.** Because the whole shape leans, the flange breaks the left flank
  ~1.5 CSS px before the right: "it reads as **two separate feet at two different heights**, which
  reinforces the plinth/pawn reading rather than the cartridge one."
- **Anti-aliasing, charged to the lean.** "The entire outline is one pixel of grey mush at dpr 1" —
  about 14% of the object's width is ramp, because a sub-7° slope crosses the pixel grid at a rate
  that guarantees a graded edge on every row. The bottom row of the dpr-1 bake contains "not one
  solid pixel"; the flange "does not read as a rim, it reads as the sprite dissolving into the
  plate". And **the two densities read as different objects** — a blunt dome at dpr 2, a near-point
  at dpr 1: "retina viewers see a hood; non-retina viewers see a spike."
- **A factual correction, and it is right.** `TILT = 0.12` rad is **6.88°**, not the "~10°" the code
  comment claimed — a stale number left over from an earlier value. "The lean is 30% shallower than
  the code says it is."
- **Style, unchanged from rounds 1 and 2 and put more harshly.** "It reads as a glyph … a filled
  polygon with straight sides, a hard right-angled notch, a flat base and one curve at the top. That
  is vector-UI construction." The 0.6 contour puts ~0.3 px outside the fill, "invisible as a
  *contour*, and only functions as a uniform soft halo". It rendered `warning.sheet.png` alongside
  for calibration: `warning` uses **26 × 23 CSS px** of its 28 box, has a white hole punched through
  its crown loop and two detached arcs, and "looks drawn"; ammo is **14 × 24** with "zero interior
  white anywhere" and a silhouette "convex everywhere except one 3 px notch". "On the same HUD plate
  it will read as visually half the weight of its neighbour, for nothing gained."
- **The single point of failure.** "The entire identity of the object rests on one 2.9 px event …
  a shape whose meaning has a single point of failure 3 px wide at the size it ships is not a robust
  silhouette." And: "convex black blobs are the weakest silhouettes there are."
- Colour clean — it scanned every pixel of both sheets, **maximum chroma 0**. **No generated-imagery
  artefacts of any kind**: "no ringing, no resampling halos, no colour fringing, no melted or
  duplicated detail, no stray specks. It is procedurally drawn and it looks it."
- Its three highest-return changes, in order: **make it bigger** (14 of 28 px against `warning`'s
  26), **punch some white into it**, **decide about the lean**.

**Done: reverted to plumb, and this is now settled rather than open.** The tilt failed on exactly the
terms it was granted on, and the evidence is not a matter of taste:

1. **The cold read went backwards.** Round 2, plumb: *rocket or missile, then a bullet or cartridge,
   then a lighthouse or obelisk* — cartridge **second**. Round 3, leaning: *hooded figure, headstone,
   chess pawn* — cartridge **fourth**, reached for rather than seen, and gone entirely without the
   filename. The **pawn**, closed in round 1, came back; and the figure reading is worse than
   anything in this file's history, because a person is further from a cartridge than a rocket is.
2. **The shoulder is worse where it matters.** The notch was the whole reason to redraw. At dpr 1 it
   is a chamfer on one flank and absent on the other; the plumb bake steps 2 px per flank, on both
   flanks, at the same height, because vertical walls on integer edges cost no anti-aliasing.
3. **The lean caused the two findings that push hardest toward the wrong object** — the staggered
   shoulder heights and the two-feet base — and it caused the grey flanks that dissolve the rim.

**What was *not* the problem is worth recording too.** Round 2's diagnosis of bake 3 was right about
the mechanism: rotating finished art is what had destroyed the notch, and building at the angle did
save it — at dpr 2 both flanks stepped, and the two notch angles matched to within a fraction of a
degree. Fixing the mechanism simply did not rescue the idea. A cartridge at 26 px has no lean that
both reads as deliberate and leaves the bottleneck legible: shallow enough to look upright is a
crooked headstone, and the reviewer's alternative — 20–35° — abandons the axis-aligned walls that are
the only reason the notch survives dpr 1 at all.

So the house-style rule has one recorded exception with a reason behind it. **Ammo stands plumb.**

The reverted bake is byte-identical to the one committed in `a569ed4`; bake 6's own numbers, for the
record, were 29×49 device px at dpr 2 with ink at 81% of covered pixels (against the plumb bake's
26×48 and 89% — the extra 8 points of grey are the lean), and 16×26 at dpr 1.

## Round 4 — bake 7, three cartridges, and the end of the single round

Round 3 left one item open: the icon covered **13×24 css px** of its 28 box where `warning`, its
neighbour on the same HUD plate and in the same box, covered **26×23** — half the visual weight, in
a HUD whose job is to be read at a glance mid-fight. That was ranked the highest-return change
available.

**The trade, and how it was resolved.** A real cartridge is nearer 0.3 aspect; the shipped one was
0.54. Slimming says "cartridge" harder and costs mass. Widening one round to `warning`'s weight puts
it at ~26 × 24, an aspect of 1.08, which is a dome. Matching the weight with a *single* round was
therefore not available at all. So the mass came from **drawing more than one round**, which buys
both halves of the trade at once: the group carries the weight, each round can go slim, and — the
part that actually mattered — **a group of identical objects is a much harder silhouette to
misread**. Every cold read in three rounds came back rocket, lighthouse, obelisk, pawn, headstone or
hooded figure. All six are things that stand alone.

### What was drawn

Three cartridges, **6 × 22 units of ink each** (aspect **0.27**, against the old 0.54), on one
baseline, with **3 units of paper** between neighbours. Per round: an ogive nose, a parallel-sided
neck and shank longer than the nose, a **hard horizontal shoulder ledge** rather than the old
diagonal ramp, and a straight-sided case to a flat base. No rim, no flange, no case head.

Two numbers govern the whole layout: `CASE_HALF` and `NECK_HALF` are set so the **ink** edge — the
path plus half the 0.6 contour — lands on a whole unit, and every station down the round does the
same. That is what makes this the first bake of this icon whose walls, base and shoulder are hard at
**dpr 1** and not only at dpr 2. Round 3's verdict on the old shoulder was that it was "a 45° chamfer
on one flank and gone on the other" off retina — *"the feature the design depends on is a
retina-only feature"*. It is not one any more.

### The numbers, against `warning`

Measured off panel 2 of each sheet — the panel that shows what the game actually blits.

| | ammo, bake 7 | ammo, bake 5 (shipped) | `warning` |
| --- | --- | --- | --- |
| bounding box at real size | **24 × 22** css px | 13 × 24 | **27 × 23.5** |
| ink covered at real size | **1314** device px | — | **1303** device px |
| dpr 2 bake | 48×44 device px, ink 94% | 26×48, ink 89% | — |
| dpr 1 bake | 26×24, ink 37%, no edge warning | 14×26, ink 62% | — |
| max chroma, both densities | **0** | 0 | 0 |

**The weight gap is closed on the measure that matters.** The bounding box is 24×22 against 27×23.5,
but the box is the weaker number — `warning`'s includes its two thin outer arc pairs. On *ink
actually laid down at real size* the two icons are within 1%: 1314 against 1303.

The dpr 1 ink share falls from 62% to 37%, and that is arithmetic rather than a defect: three narrow
shapes have roughly three times the perimeter of one fat one for the same area, and at 28 px the
perimeter is where the grey lives. The README's *Do not "fix" the anti-aliasing* covers exactly this.
Every wall in the drawing is hard; the grey is on the noses and the corner joins.

### The extractor groove: built, measured, dropped

A mid-round correction pointed out — **correctly, and it is checkable** — that this file's standing
reason for declining interior white was wrong. `warning.ts` says *"No interior detail: at 28 px a
highlight is a smudge"*, and rounds 1–3 read that as "the sister icon uses no interior white". A
flood-fill from the border says otherwise: `warning` encloses **13 css px²** of white through the
hole in its crown loop. It avoids interior *highlights and shading*, which is what its comment is
actually about; it very much uses **structural negative space**. Those are two different moves and
this file had conflated them, which blocked the question three times.

So structural white was tried on its own merits: an **extractor groove**, two bites of paper out of
the flanks where the case head meets the body. It cannot sever the form — it bites the edges and
never crosses the axis — so the failure that killed bakes 2 and 3 does not apply by construction.

It was baked at two depths. **Neither survives dpr 1.**

| bake | dpr 1 ink share | what the silhouette does at dpr 1 |
| --- | --- | --- |
| no groove | **38%** | clean tapered cylinder |
| groove, 1 unit deep | 34% | base becomes a **flared foot** |
| groove, 2 units deep | 29% | a **foot on a stem** — the pawn, returned |

Both are crisp at dpr 2. The void is only ever 1–2 device px across off retina, and the 0.6 contour
eats 0.3 of its height from each side, so what lands is grey rather than paper — and grey in that
position reads as a pedestal. This is precisely what round 3 condemned: a feature present on retina
and gone off it, so **the two densities read as different objects**. Worse, at dpr 1 the groove
manufactures the exact pedestal reading it was added to kill.

**Declined on measurement, not on the old argument.** The correction that reopened the question was
right to reopen it, and the answer still came back no.

The mechanism the groove was meant to fix had also already gone. The finding behind it was that the
rim ran 22 → 24 → 26 units wide and never re-narrowed — a plinth. **Bake 7 has no rim.** The pawn's
foot, its single-object-ness and its diagonal shoulder ramp all went in the same redraw.

**Where the white went instead.** The two 3-unit columns of paper between the rounds are the
drawing's negative space, and they are ~**200 css px²** inside the icon's own bounding box against
`warning`'s 13. It is *open* rather than *enclosed* white, so a flood-fill from the border still
scores ammo at zero — but it is 15× the area, it is structural, and it is hard-edged at both
densities because the walls either side of it are.

### Cold read

A fresh subagent, given the two sheets with **the sprite's name cropped out of the image** so it
could not read "ammo" from the header — round 3's reviewer declared it had read the filename first,
so this round removed the option. Asked for its top three guesses before anything else.

> **1. A rifle/pistol cartridge — a bullet. ~65%. From panel 2, immediately.** "No work required. I
> saw panel 2 and thought 'three bullets' before I'd finished looking. The tell is the width step: a
> domed-tip column that steps *out* to a wider straight-sided base with a flat bottom — projectile
> seated in a case."
>
> **2. A lipstick / chapstick / glue-stick tube. ~15%.** "Same silhouette read a different way … at
> real size the tip is blunt enough that this is a live alternative — the taper is only ~4 rows out
> of 44 before it goes straight, so it is barely pointed."
>
> **3. A battery cell, a chess pawn, or a small tower/obelisk. ~10% combined, and I had to work for
> this one.** "Weak … Pawn is wrong (no waist, no round head). I'm listing these because nothing else
> fits, not because any of them convinces me."

Set against the baseline it was replacing — *chess pawn 60%, gravestone 20%, bullet 15%*, and that
with the word "ammo" visible in the header — this is the whole point of the round. **Cartridge went
from third and assisted to first, unassisted, immediate.** The pawn survives only as a named
non-starter inside a 10% bucket the reviewer said nothing convinced it of.

It also confirmed the three read as one kind of thing — "not similar: identical" — and that the two
densities are the same object at the same on-screen size, the dpr 1 print being softer but not
different.

### Two findings acted on, and one reversal

- **The stagger read as drift, and it is gone.** The three rounds stood at three tip heights for one
  bake, on the theory that a stagger would read as objects placed by hand rather than as a picket
  fence. The reviewer's first note after naming the object: the 1- and 2-unit offsets are *"not a
  row, not an arc, not a deliberate scatter … it reads as drift"*, and it noticed it immediately.
  Drift is the one thing an icon must not look like — round 3 rejected the lean on the same grounds,
  *"too small to be a gesture and too large to be plumb"*. **Flattened to one baseline.** The picket
  fence never materialised: three objects separated by two full-height columns of paper are not a
  fence, and the cold read had already landed at 65% cartridge with the stagger in place, so the
  stagger was not carrying it.
- **The nose was too blunt, and it is sharper.** Two reviewers independently: a *lipstick tube* here,
  a *finial* from the mid-round correction, both tracing it to the same cause — the ogive reached
  full width in its top third and then ran straight, so the taper was ~4 device rows out of 44. The
  ogive is longer (3.6 → 4.0 units) and its second control moved down (1.48 → 2.8), which spreads the
  taper over most of the nose. The nose is still only 18% of the round's height, so this does not
  re-open round 2's finding that a long point is a rocket.

Cost of the two edits: the bounding box lost 2 units of height (24×24 → 24×22) and the bake lost 15
ink pixels. Neither is material next to the drift reading.

## Not done, and why

*Round 4 closed three of the four items that used to live here. What is left is below; the closed
ones are recorded in the Round 4 section with the numbers that closed them.*

- **The redrawn-at-angle tilt.** Tried in round 3 and reverted; see above. Not an open question any
  more.
- **The interior highlight sliver, raised three times.** Still declined, and round 4 declines it on
  narrower grounds than the earlier rounds did — see Round 4, where the reasoning that was used to
  decline it is corrected. A highlight down a 4-unit-wide neck is a smudge at 28 px, which is what
  `warning.ts` says in as many words about *its own* dome. That much stands. The claim that
  `warning` therefore uses no interior white at all was wrong, and structural white was tried on its
  merits in round 4 rather than inheriting that argument.
- **A larger box.** Never asked for and still not wanted: 28 is what `warning` and `reconnecting`
  draw in, and three icons on one HUD plate at two different box sizes would read as a mistake.
  Round 4 got the weight from filling the existing box instead.

## What the sheet shows

Final bake (bake 7), dpr 2: covers **48×44 device px** inside the 56 px bake, ink **94%** of covered
pixels, no edge warning — 2 css px of margin either side, 3 top and bottom. At dpr 1: **26×24**, ink
37%, no edge warning. The lower ink share at dpr 1 is the expected softness at that resolution and
not a thresholding problem (README, *Do not "fix" the anti-aliasing*); it is lower than bake 5's 62%
because three narrow shapes carry about three times the perimeter of one fat one at the same area,
and at 28 px the perimeter is where the grey lives.

Max chroma **0** across every pixel of both sheets.

Both densities were rendered and looked at every round. The dpr 1 sheet is not committed — only the
dpr 2 sheet is, per the loop.

## Review

**Reviewed four times across seven bakes**, each time by a subagent that read the sheet, per
ADR 0002. Every one was given the sheets at both densities and told to be blunt.

- **Round 1** saw bake 2 cold and named the chess pawn.
- **Round 2** was told the full history of what had been tried and reverted, so it could not be
  flattered by improvement.
- **Round 3** was told nothing at all and asked for its cold read first, which is how the *hooded
  figure* verdict was reached. It also read the sprite's name out of the sheet header and said so.
- **Round 4** closed that hole: the name was **cropped out of the image** before the reviewer saw it,
  and the cold read was taken before the reviewer was told anything, including what the sprite was
  for. It was then given the full brief and the sister icon for calibration in a second pass.

All four rounds are recorded above including the findings not acted on, the one that reversed a
change, and the one recommendation that was built at two depths and dropped on its own numbers.
