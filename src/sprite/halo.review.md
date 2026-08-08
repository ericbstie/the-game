# halo — blind review

Two blind reviews, per ADR 0002. Neither reviewer was told what the sprite was, what it was
supposed to depict, or that anything had changed. Both are reproduced **verbatim**, including the
findings the implementer disagrees with.

The first was given only `halo.sheet.png` and asked what object it depicts. The second was given a
rendered game frame and the neutral brief that produced #160's original finding — *"a tutorial is
highlighting one spot on the ground"* — and asked to list every candidate it considered. That
second review is the ticket's acceptance test: the whole point of the redesign is that the self
marker should no longer compete for "look here".

---

## Review 1 — the sprite sheet, blind

> ## What I found
>
> **1. Object depicted.** A closed, flattened ring — a thin oval/hoop shape with a hollow (white) center, tilted off-axis. My two readings, in order of confidence:
> - **A ring/hoop/halo seen at a tilt** — the closed loop, roughly even wall thickness, and the way it's canted like a hoop leaning away from the viewer all read as a ring first.
> - **A stylized eye or almond shape** — the pointed-ish left/right ends and the flattened lens proportions could also read this way, especially at the smallest size where the "ring-ness" is lost.
>
> Nothing in the mark (no radiating lines, no cross-hatched glow, no gap or clasp) disambiguates between these, or points specifically to "halo" over "ring," "bracelet," or "tire."
>
> **2. Shape.** A thin, elongated ellipse, roughly 3:1 wide-to-tall, rotated diagonally rather than sitting level — the left end sits lower, the right end higher (or vice versa depending on frame). It's a closed loop (not open/broken) with a hollow, unfilled interior. The stroke is not uniform: it reads heavier/solid black along the bottom arc and lighter/grayer along the top arc, which plays as directional shading on a 3D torus rather than a flat ink line of constant weight.
>
> **3. Hand-drawn or machine-generated: reads as machine-generated, and fairly clearly so.**
> - The top arc of the ring is not a flatter black line but a smooth black-to-gray gradient (confirmed by pixel sampling: solid grays like (154,154,154), (216,216,216) forming a soft ramp along the top inner edge). Hand inking doesn't produce smooth grayscale gradients inside a stroke — it produces flat ink density, or cross-hatching/stippling for shading, not an airbrushed ramp. This is a giveaway of a rendered gradient fill.
> - There is a soft, evenly-distributed cream/pale-yellow glow (RGB samples like (255,252,236), (255,254,251) — note the depressed blue channel, a genuine warm tint, not grayscale antialiasing) surrounding the entire ring at a roughly constant offset. That's characteristic of a `shadowBlur`-style glow/drop-shadow effect, which a printing press could never produce and which undercuts the "hand-inked" premise directly.
> - At full magnification the stroke's outer edge is a clean, near-uniform stair-step rather than the ragged, variable-pressure edge of real ink on paper — it reads as an antialiased vector stroke, not a scanned brush line.
>
> **4. Colour.** Overwhelmingly black-on-white: black stroke, white paper, plus antialiasing grays at the edges. But there is a distinct third colour — a pale cream/yellow glow ringing the entire shape — that is neither black, white, nor neutral gray. It's a thin band, maybe 5-10% of the total ink area by pixel count, but it's the single most colour-inconsistent element on the sheet, and it's the same colour on every panel, so it's not a one-off compression artifact.
>
> **5. Legibility at smallest size (panel 2, true ~22px).** It survives as a small dark oval smudge with a faint white sliver in the middle — the hole doesn't fully close up into a solid blob. But at that size it no longer reads as anything specific; it's just "a dark oval mark." You could not tell a viewer it's a halo (or a ring, or an eye) from this panel alone and expect them to get it right.
>
> **6. Craft problems.**
> - **Detached fleck above the stroke.** Zooming the top-center of the ring shows a small gray blob sitting one full pixel-row *above* and disconnected from the main black outline — not touching it. This is visible even at true size (panel 2) as a tiny bump. It looks like a rasterization artifact (a stray sample from a stroke-join or a stamped round-cap segment) rather than an intentional ink flick, and it's the kind of thing that would read as dirt/noise in a crowded scene.
> - **The colour glow itself** (see Q3/Q4) is the biggest single flaw against the stated "hand-inked black-and-white" style — it's a soft, warm-tinted blur, structurally a digital shadow/glow effect, and it's present at every zoom level shown, so it's baked into the sprite, not a viewing artifact.
> - **Gradient shading inside the stroke** is likewise a digital tell, not an ink technique.
> - No clipping against any of the three box edges — the shape sits comfortably inside its bounding box in every panel.
>
> **7. Would it read instantly as one specific thing in a crowd of other B&W marks? No.** It's a generic hollow oval with no distinguishing iconography — no radial ticks, no notch, no asymmetric feature that says "halo" specifically. Among other black marks it would most likely be mistaken for an eye, a shadow ellipse, a wheel/tire, a mouth, or a chain link before it read as a halo. Combine that with the fact that its clearest "brand" — the coloured glow and gradient shading — actively work against a hand-inked black-and-white read, and the sprite doesn't currently earn instant, unambiguous recognition.

---

## Review 2 — a rendered game frame, blind, on #160's original brief

Asked which mark is the tutorial's highlight, and to list every candidate considered.

> ## 1. The tutorial's highlight
>
> It's the **gray corner-bracket reticle** sitting on the ground just left of the black mineral-vein patch, roughly two-thirds of the way across the frame and just below the vertical midpoint (around image coordinates 1020–1130, 575–670). It's drawn as a square built from four separate L-shaped corner marks (open in the middle, like a camera focus/target-lock frame) rather than a solid outline. […]
>
> ## 2. How long it took
>
> Not immediate. I had to compare candidates — there are two separate tutorial text blocks in this single frame […] and each one has plausible nearby ground marks it could be pointing at. I had to rule out the wrong pairings before settling on the bracket reticle as the one clearly built as a UI pointer rather than a world object.
>
> ## 3. Every candidate considered
>
> - **The red-speckled rock vein near "Ana/Ben/Cy"** […] Ruled out as *the highlight mark* because it's the resource itself (a world object, colored to indicate ore type), not a pointer overlay […]
> - **The black ring/circle** at ≈(850–1000, 605–750), overlapping "mine to get metal" — a strong candidate since a ring is a classic "target this" reticle shape. Ruled out on closer look: it reads as a large closed circular icon/portal shape sitting on its own, not obviously locked onto a specific ground tile […]
> - **The gray bracket reticle** at ≈(1020–1130, 575–670) — settled on this one. […]
> - **The row of red/pink dots** itself […] it reads more as a connecting trail/sightline than a "spot" […]
> - **The red dome/helmet shape** at ≈(760, 310) […]
> - **The crossed-out lightning "Z-A" icon** at ≈(975–1055, 740–790) […]
> - **The "+1" popups and cart/robot icons** (top-left cluster) — quickly ruled out […]
>
> ## 4. Other things competing for "look here"
>
> - The bold "**BAM**" and "**BOP**" comic bursts (three of them) pull the eye as impact/action markers, but they're clearly combat effects, not tutorial UI.
> - The two player name labels ("Ana," "Ben," visible partial "Cy") with small health-bar ticks compete for attention as HUD elements.
> - The white square minimap in the top-right corner is a strong visual anchor purely by being a large empty rectangle against a busy background, but it's plainly a map/viewport, not a ground highlight.
> - The red-dot trail itself is a secondary "look here" cue […]

**The self halo is absent from the candidate list and from the competing-marks list.** The previous
ring, on the same brief, was reported as *"a second, thinner ring circling a player character…
briefly competed with it as 'the' highlight"*. That is the change #160 asked for.

---

## What the implementer did with these

Both of review 1's concrete findings were reproduced before being recorded. Neither is dismissed.

**The detached fleck is real, and it is intentional.** It is the pen's overshoot crossing its own
start — the same device the previous halo used, and the thing in this style that says a hand drew
the mark rather than a machine. The reviewer, given no such context, read it as rasterisation dirt.
That is a fair result and it is not a defect in the reviewer: an intent that reads as noise is not
working. Left as drawn for now, because it is load-bearing for the hand-drawn read that the same
review otherwise says is failing — removing it would make finding 3 worse. Flagged as the first
thing to revisit if it is ever called out again.

**The warm glow reading as `shadowBlur` is reproduced and is not a blur.** It is three flat tone
steps printed slightly out of register with the ink, which is how the era printed a glow; at a 22px
box the steps are about 0.45 units apart and merge into what looks like a ramp. The reviewer's read
is honest and the implementation is deliberate. Not changed — the alternative is fewer, harder
steps, which is a legibility trade nobody has played yet.

**The colour is not a new grant.** #76 already grants this sprite a glow "barely yellow, mostly
white", and `WARM` is unchanged from the ring this replaces. Review 1 is right that it is the one
non-neutral thing on the sheet; that was true before this ticket too.

**"Does not read instantly as a halo specifically" is accepted and not fixed here.** Review 1's
first reading was nonetheless "a ring/hoop/halo seen at a tilt", and review 2 — the one that
matters for #160 — shows it no longer competes with the tutorial's mark. Whether it reads as *your*
marker in a played match is exactly the kind of question this repo does not settle from a still.

Lift, travel, period, the exact yellow and the stroke weight are all provisional. A later change to
any of them is a retune, not a correction.
