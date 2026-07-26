# grunt — review

Visual review of `grunt.sheet.png`, per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md).
A subagent read the PNG and looked at it; the findings are advisory and the sprite ships on the
author's call. Five rounds were run, each on a freshly rendered sheet.

## What the sprite is

A spider exaggerated into **legs** — the elite is exaggerated the other way, into a body, and in a
black-and-white game silhouette is all that separates them. 8 facings × 2 frames in a 32 px box,
anchored at the feet.

The projection is the hybrid #76 fixes for spiders: **body and face upright, legs splayed flat
around them**. Only four legs are authored — one side, front to back — and everything else is
derived: the other side is that mirrored with its gait halves swapped, the 8 facings are one
rotation of the plan, and the face is a pair of eyes on a ring around the body's axis, so turning
the creature turns them rather than moving them.

## Round 1

> Still an octopus. The body reads first and the legs read second and short. The round core
> registers before the legs do. At side-on the single white eye reads as a lone cyclops mark —
> "a hole in a blob" rather than a face. Facings are hard to tell apart: the body silhouette is a
> near-identical round blob in all eight columns. Frame 0 does read as a settled stance, and the
> leg line quality is on-model.

**Changed:** body cut from 8.4 × 9.8 to 7.2 × 8.2 px, front legs lengthened and the rear pair
shortened so the fan points, and the far eye brought back at E/W so the face reads as a pair
instead of a single hole.

## Round 2

> Reads as a spider now, not an octopus — the boneless-blob impression is gone. But "long-legged"
> is still the second read, not the first: a solid black core with thin radiating spikes, closer
> to a starburst. Legs are 1 CSS px wide, so after anti-aliasing they are pale grey against a
> solid black body. **Root fix: 2 px legs, longer, smaller body.** The leg arrangement is close to
> perfectly radially even, which reads mechanical. Frame 0 correctly reads as standing.

## Round 3

The most detailed pass; it measured the baked pixels rather than eyeballing them.

> 1. **A false second eye on both side-on facings.** The rear leg hooks over the head and fuses to
>    the body contour, leaving a fully enclosed white oval at the same height and nearly the same
>    size as the real eye. E then reads as looking *at the camera*, not East. It is also
>    inconsistent between frames, so the false eye blinks during the walk cycle. "The single worst
>    thing in the sheet: it destroys the facing read, which is the sprite's whole job."
> 2. Adjacent legs merge into flat paddles — a wide black slab with a hairline slit. The visible
>    leg count drops from 8 to 6 every other frame.
> 3. Apparent body mass nearly doubles between facings; N carries 11–15% more ink than E and is
>    squat. **N drifts toward the elite's brief — big body, short legs** — which is the facing that
>    puts the grunt/elite separation at risk.
> 4. NW and NE show a full eye while facing away, so the rear-quarter views read as staring at you.
>    Full → absent → full across three adjacent facings: turning in place looks like blinking.
> 5. **Movement is a pulse, not a scuttle** — a symmetric open/close of the whole fan with no
>    left-right phase offset. "It looks like the creature inflating and deflating."
> 6. Some legs are dead-straight spokes rather than tubes; the head is lumpy and faceted where leg
>    knees poke through it.
>
> Good, and not to be touched: pure black and white, zero non-grey pixels; no detached parts, every
> bake a single connected component; no interior detail or hatching; the hybrid projection reads
> naturally rather than as a mistake; **frame 0 is a real standing pose and the frame assignment is
> the right way round**; the facing scheme (two eyes centred = S, offset = SE/SW, one at the
> leading edge = E/W, none = N) is clean and consistent.

**Changed, in order of the findings:**

1. **The arch is now spent only on legs that run across the screen.** A leg pointing up or down the
   screen is already stretched by the plan squash; arching it as well folded it into a hairpin that
   pinched the white hole against the head. That was the mechanism behind the false eye, the lumpy
   faceted head and most of the merged slabs, and one rule removed all three.
2. Leg spreads evened out (40/78/118/154), every leg given real in-plane curvature, and the front
   pair's hook opened up so the front legs splay instead of converging into a horseshoe.
3. Rear legs lengthened from 10.6 to 11.6 so N stops being squat — at N it is the *rear* legs that
   point at the viewer, which is why that facing was the heavy one.
4. **The face is now drawn as a pair or not at all**, gated on the head itself being toward the
   viewer. NW/N/NE are faceless; E/W keep the pair.
5. **The gait was genuinely wrong and is fixed.** Frame 0 was parked dead even, so the two frames
   were a symmetric open-and-close. Frame 0 now keeps about a third of the counter-stride, so the
   frames counter-pose and the phase offset that makes a scuttle read exists. It is small enough
   that the stance still settles — and it costs the exact mirror symmetry that gives a drawing away
   as generated, which round 2 also flagged.
6. Leg weight rebalanced: narrower at the hip where eight legs converge, heavier through the belly
   of the curve, and never below ~1.3 px, which is the point at which a stroke stops being a fine
   line and becomes an intermittent grey smear.

## Round 4

> No enclosed white pockets left — that defect is resolved. Movement reads as a scuttle, not a
> pulse. Frame 0 genuinely reads as a stopped pose. But **every limb is one unbroken curve from
> body to tip with no direction change anywhere in the run. A pure arc reads as a tentacle no
> matter how well it tapers** — a rubber-hose limb needs at least one angle before it reads as a
> limb. **Verdict: not ship as-is.**

That is the round that mattered most, and it was right. Every earlier pass had treated the octopus
read as a proportion problem — smaller body, longer legs, thinner strokes — and proportion was
never the thing. The leg was a single cubic from hip to foot, so however it was weighted it stayed
one smooth arc.

**Changed:** each leg is now **two hoses meeting at a knee** — a thigh that climbs from the body
and holds its height as it arrives, and a shin that drops away at once. The knee sits at 58% of the
leg and is its thickest point, so the bend and the taper land together, which is also where a
spider's weight actually is.

## Round 5

> The joints read now — a real knee bend, a genuine improvement over the arc. Ink style on target,
> frame 0 legibly the calmer standing pose, no rogue heavier column, no detached parts, leg count
> consistent across frames. **But at real size the fan collapses into a four-stroke glyph** — a
> trunk with two strokes splayed up and a few down, closer to a figure with its arms raised than to
> a many-legged creature. **Highest-value change: make the fan read as *many* long legs — thin and
> separate the strokes so the silhouette stops collapsing.**

**Changed:** legs thinned (knee 2.0 → 1.62, tip 1.3 → 1.12, feet smaller to match), the arch
lowered so fewer legs project above the body as "raised arms", and the spreads pulled in and evened
out (33/71/111/151) to close the wide empty wedge at the front that was making eight legs look like
four. The legs separate and can be counted at real size now.

## Outstanding, and shipped anyway

The reviewer is advisory (ADR 0002 §3) and these are the notes it travels with:

- **The rear legs, which the projection puts *above* the body, can be misread as antennae** at a
  glance. That is inherent to the hybrid — legs behind an upright body have to be drawn above it —
  and thinning the legs so the whole fan reads made it much weaker. Left as is.
- **S/SE/SW carry more ink than E/W.** More legs are visible face-on than edge-on; the reviewer
  called this a consequence of the projection rather than drift, and it is.
- **The face is lost at `--dpr 1`.** See below.

## Author's notes

- **`--dpr 1` was checked as well as the default 2**, and the fractional 1.5 that Windows display
  scaling produces. The silhouette holds at all three: the legs stay continuous and countable
  rather than breaking up, which is what keeping the tip above a whole logical pixel bought. The
  **face is lost at dpr 1** — an eye is about 2 device px there and the body reads as a solid blob.
  Accepted: facing is carried by the leg fan, and the separation from the elite was never going to
  rest on the face.
- **Ink is 51% of covered pixels at dpr 2, 23% at dpr 1.** The dpr 1 figure is the anti-aliasing
  the contract says not to fix; it is a resolution floor, not wrong ink.
- **The grunt/elite silhouette separation is safe.** The elite is a 48 px box almost filled by one
  body with short limbs below it; the grunt is a 3.4 px-radius body inside a 27 px leg fan. They
  are not confusable at any facing, and the N facing — the one round 3 flagged as drifting toward
  the elite — was corrected.
- **Frame 0 is the standing pose**, per the decision on #81, and every round confirmed it reads
  correctly on its own.
