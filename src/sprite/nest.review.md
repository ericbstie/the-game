# nest — review

Reviewed by a subagent against `nest.sheet.png`, per [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md).
Advisory, not blocking. Recorded as given, then answered.

Three reviews were run, on the round 5, 7 and 9 sheets, by three separate subagents none of which
saw the others' notes. All three are reproduced. The sprite shipped at round 12.

---

## Round 5 — the reviewer's findings

> **Verdict:** the pair works as a before/after, but the intact one is not a nest, and the
> destroyed one is a mouth. Both problems are fixable without changing the ink language, which is
> the part that's right.

**1 · Does destroyed read as destroyed? Yes — the strongest thing on the sheet.** It survives
panel 2, the only test that counts. Carried by the broken-open rim, the collapse in height, and
debris outside the silhouette. Undermined by one thing: **the jagged rim reads as teeth.** At real
size it is a black lump with a row of white triangles across its top edge — first read was an open
mouth or a bear trap, not a corpse. Two causes: the zigzag is a continuous row of near-equal
triangles, which is the grammar of a cartoon jaw; and the interior behind it is ~90% solid black,
so the triangles read as teeth against a throat rather than as shell against a cavity.

**2 · Does intact read as a nest? No.** First impression at real size was **a bowling ball**, then
a film reel, then a die. "Egg sac" was not on the list. The dots are perfect circles, hard-edged,
evenly scattered, sitting inside a smooth closed ring without touching. Black circles inside a ring
read as holes punched through a solid, not eggs in a membrane. The outer contour and the contents
are unrelated — an egg sac's silhouette should be deformed *by* the eggs pressing outward. No eggs
overlap; real clutches crowd. No opening, so nothing suggests spiders come out. No silk. Secondary
risk: a latent **face** — the big left oval plus the upper-right one read as mismatched eyes, with
the two bottom ovals as a snout.

**3 · Do they read as the same object in two states? Weakly — second must-fix.** The defining
feature of the intact sac is the field of eggs and **not one survives into the wreck.** Destroy a
spotted ball and you should get spotted fragments.

**4 · Rubber-hose ink? Mostly yes, and the contour weight is genuinely good.** The exception is
**the hatching**, on both variants. Diagonal parallel hatching is woodcut/engraving vocabulary, not
1930s rubber-hose — that era shades with solid black shapes and a hard terminator, not line
screens. It is also the worst-performing element at scale: at real size it collapses into a grey
smudge that reads as *a bite taken out of the outline*.

**5 · Black and white? Yes. Clean.** Greys only from edge anti-aliasing.

**6 · Artefacts.** Contour collision at 12–1 o'clock — the top oval merges with the outer contour
and puts a black notch in the silhouette, reading as a chip. Double contour at 3–5 o'clock (outer
stroke plus a near-parallel inner one with hatch between) reads as a machined rim or lens bezel — a
big contributor to "film reel". A stray speck at 2 o'clock and a stray flick at bottom-centre.
Mechanically even hatching: identical angle, identical spacing, straight lines clipped to the shell
rather than curving with the form — **the clearest generated-imagery tell on the sheet**. Mirrored
puddle nubs: the floor splat has near-symmetric lobes at each end that read as little feet. The
shell floats *on* the puddle rather than sitting *in* it. **Projection drift between the variants:**
intact is drawn flat-frontal with no top surface visible at all — a disc — while destroyed is
three-quarters from above. Same object, two camera angles; the intact one is wrong per the
elevation spec.

**7 · Broken at real size.** Destroyed interior is mud — a solid black mass with a few white specks;
the smallest shards disappear. Exterior debris shrinks to 2 px specks that read as dirt on the
screen. All hatching fails, both variants. Eggs dominate: so high-contrast they beat the contour
for attention, which is exactly why "ball with holes" wins over "sac".

**Ranked must-change:** (1) intact does not read as a nest — fix the cause: eggs overlap and
cluster, contour deformed outward where they press, no perfect circles, add an aperture; (2)
destroyed reads as a toothy mouth — break the zigzag rhythm, stop filling the bowl solid; (3) no
shared identity — eggs must survive into the wreck; (4) destroyed interior is mud, needs white
space; (5) projection mismatch. **Nice:** drop the hatching and shade with a solid shape; fix the
contour collision and double contour; remove the two stray marks; de-symmetrize the puddle and seat
the shell into it; make debris larger and fewer. **Fine, don't touch:** the black-and-white
discipline, the contour weight and solid-fill confidence, the height collapse between states, and
the bottom-centre anchoring.

---

## Round 6 — what changed, and what did not

Every must-change was acted on.

- **The contour is now derived from the clutch.** `membraneAround` walks a ring of directions and
  pushes the outline out to the far side of whichever egg reaches furthest, plus the membrane's
  thickness. The skin now bulges exactly where an egg presses it, because it is computed from the
  eggs — the reviewer's "contour and contents are unrelated" cannot recur by construction. The
  margin widens toward the top, which gathers the bag into a pale crown above the brood.
- **The clutch crowds.** Eight unequal eggs that overlap, each stroked pale before it is filled so
  it cuts a separating halo into the ones behind. Crowding without merging was the constraint;
  spaced pips and a single black blob are the two ways to lose it.
- **The opening is a crescent, not an oval.** A dark ellipse with a paler one laid over it leaves
  the far inner wall showing as a crescent, which is what looking down a tube gives you. It also
  answers the projection note: the crown now shows a top surface, so both variants are seen from
  the same slightly-above elevation.
- **The tear is uneven.** Nine break points, none mirrored, two of them blunt flats rather than
  teeth, one a long slumping run. The regular triangle rhythm that read as a jaw is gone.
- **The wreck is no longer filled solid.** Its interior is pale, with wall thickness drawn inside
  the rim, and the ink is confined to a residue pool with a hard terminator sitting in the bottom —
  the reviewer's own prescription for shading in this style.
- **Eggs survive into the wreck.** Two still cling to the inner wall, one half-sunk in the residue,
  and one ruptured egg has been thrown clear onto the floor. That is the shared identity the pair
  was missing, and it replaces the sub-pixel debris specks: one larger object instead of three that
  vanished.
- **Hatching is cut.** It failed at real size twice, in two different forms — contour-following
  (read as a spiral) and straight parallel (read as a barber pole, then as a bite out of the
  outline). It is replaced by what the era actually used: the contour swells on the shaded side,
  built from offset stroke passes, which tapers by itself where the curve turns parallel to the
  offset. This also answers the standing note that one uniform stroke width reads as CAD rather
  than ink. #76 permits hatching on a sprite this large; it does not require it, and the measured
  result is that it costs more than it returns here.
- **The stray speck and flick are gone** — both were artefacts of the hatch clip edges, and went
  with it. So did the double contour at 3–5 o'clock, which was that clip's inner boundary.
- **The puddle is asymmetric** — a lumpy ring rather than an ellipse, with unequal silk anchors —
  and it is now drawn *over* the base of the sac, so the sac sits in it rather than on it.

Left alone deliberately, and why:

- **The eggs still carry a lot of contrast.** The reviewer is right that they beat the contour for
  attention. They are also the only thing that says *brood*, and the fix for "ball with holes" was
  to correlate them with the silhouette rather than to quieten them.
- **Panel 3's empty column** is the harness's layout, not the sprite's, and this sprite has one
  frame so there is nothing to put there.

---

## Round 7 — the second reviewer's findings

A fresh subagent, given the same brief and no sight of the first review.

**1 · Intact reads as a nest? No — "a blackberry, or a drawstring pouch full of black marbles",
second reading a beehive.** Solid black lumps separated by thin white webbing is berry and caviar
vocabulary. The outer shape is a rigid faceted polygon that ignores its contents; nothing sags or
bulges. No spider signal at all.

**2 · Destroyed reads as destroyed? Yes, mostly — the stronger of the two, and it survives real
size.** Carried by the height drop, the missing top, the torn rim and the slumped contents.
Undermined by a right wall that is a clean unbroken curve with no crack running down from the rim —
it reads "opened" more than "smashed" — by nothing spilling past the footprint, and by the two round
dots reading as alive.

**3 · Same object in two states? Weakly — they read as cousins.** Two mismatches: the silhouette
language differs (intact an angular faceted polygon, destroyed a smooth ovoid), and the contents
identity differs — nine eggs against two dots in sludge.

**4 · Rubber-hose ink?** The discipline is right and worth protecting: bold contour, solid fills, no
fuss, no gradients. But the linework leans **CAD, not brush** — weight varies only mildly, with no
taper into terminals. And **the eggs carry no ink at all**: pure fills defined by negative-space
gaps of near-constant width, which is a large part of why they read as fruit. The wreck's hairline
strokes are a fraction of the ink weight and off-register.

**5 · Black and white? Yes. Clean.**

**6 · Artefacts.** **Rosette symmetry** — one central circle ringed by the others in a hexagonal
pack at near-constant gap width: "the single loudest *an algorithm placed these* signal", and it
reads as a flower or a molecule diagram. **A face on the destroyed variant** — two circles as eyes
above a dark mound curving up at both ends into a grin, with the zigzag rim as spiky hair.
**Mechanically regular zigzag** with even amplitude, period and angle, plus a self-crossing segment
near its top-centre enclosing a stray triangle. The top crescent reads as **an eyebrow** at 2×. The
flap is a **detached shard** reading as a stray mark at real size. A **doubled contour** at the
intact sac's lower left, running as two parallel strokes that converge and terminate against
nothing. A **stray horizontal bar** below the shadow.

**7 · Real size.** The **shadow fuses with the base of the sac**, taking the bottom contour with it
— it looks melted into the ground rather than resting on it. The white gaps between eggs are
hairline and will grey out. The top crescent merges into the top contour. The hairline strokes
vanish. **The intact sprite is a flat silhouette with no elevation**, while the destroyed one does
read as elevation.

**Fine, do not break:** the black-and-white discipline; bold contours, solid fills and no interior
fuss; the destroyed variant genuinely reading as wrecked at real size — "the harder of the two wins
and it landed"; and the egg *size* variation, which helps. The problem is the spacing, not the
sizing.

---

## Rounds 8 and 9 — what changed

- **The rosette is gone.** The clutch is nine eggs piled rather than packed, leaning low-left, with
  gaps running from touching to wide and no egg ringed by the rest.
- **The grin is gone.** The residue's top edge now falls steadily to one side instead of dipping in
  the middle, and the two surviving eggs are very unequal and at different heights, so there is no
  pair of eyes over a mouth. Both straddle the residue's edge: an egg landed wholly on the ink has
  its pale halo close into a ring, which is a doughnut or a third eye.
- **The tear is non-periodic** — eight breaks rising 11, 3, 12, 10, 4, 13, 6 and 14, two of them
  near-flat.
- **The self-crossing is gone by construction.** Wall thickness is now the wreck's whole outline
  shrunk and stroked inside itself, rather than the torn edge offset downward — the offset crosses
  itself wherever a break is steeper than it is wide, which is what enclosed the stray triangle.
- **The doubled contour is gone.** The swell passes are clipped to the *outside* of the shape;
  unclipped, the side where the offset points inward lays a second stroke across the pale fill.
  That was the reviewer's "two parallel strokes terminating against nothing", and it was mine.
- **The splat is flat and low**, and no longer swallows the base: the sac's bottom contour and its
  ground contact both survive at real size. The wreck's splat has a tongue running out past its own
  footprint — the spill the reviewer wanted, without adding a loose object that halos into a ring.
- **The silk is thicker than 1.5 and shorter.** Below that a stroke is a grey smear at real size
  rather than a line, which is what made the hairlines vanish; there are three strands now, not six,
  so what shows beyond the splat is a stub rather than scribble.
- **The bag is rounder.** Twelve membrane samples rather than fourteen, so each quadratic bows
  instead of running straight and faceting; and an even count so one lands square on the top, which
  gathers the crown centrally rather than swelling it onto one shoulder as a handle.
- **The vent is clear of the top contour** (more crown), so it reads as an opening rather than
  merging into a single dark band — and it is the intact variant's visible top surface, which was
  the projection complaint.

Declined, with reasons:

- **A leg or an emerging spider.** It would be the fastest possible "spiders come out of here", and
  it is also new content: #81 asks for the sac intact and destroyed, and ADR 0001 forbids anything
  beyond what was asked. The opening carries it instead.
- **Outlining the eggs instead of filling them.** The second reviewer is right that ink outlines
  would be more brush-like, but solid fills are what #76 §1 asks for and outlined eggs at 96 px put
  three concentric strokes into a 20 px circle.
- **A pale split across one egg**, tried in round 8 to say the brood hatches: at this size it read
  as a **letter**. Cut immediately — an accidental glyph is worse than a missing cue.

---

## Round 9 — the third reviewer's findings

A third subagent, same brief, no sight of either earlier review.

**1 · Intact reads as a nest? No — "a blackberry, or a bunch of grapes in a bag."** Second read
caviar in a pouch, a bag of marbles. **Rock and bush are both dodged** — too regular for one, no
foliage lobes for the other — but berry is on the same fail list and that is where it landed. The
cause is value distribution: the eggs are the solid black mass and the sac a thin white-cored skin
around them, so what a player sees is *dark clustered spheres with a rim*, which is the universal
berry idiom.

**2 · Destroyed reads as destroyed? Yes — "the sheet's strongest asset."** Carried by the jagged
rim, the tipped stance, the emptiness where the mass used to be, and the spill pooling from the
base. "The value swing does most of the work… you separate them instantly, by value alone, before
you resolve any detail. **Do not break this.**" Undermined by the two surviving eggs nearly
vanishing at real size — the wreck reads *totally* empty, which loses the "this used to be full"
story — and by those two dots under the sawtooth reading as **an open mouth full of teeth with two
eyes**, seen at real size before "broken shell" was.

**3 · Same object in two states? Weakly — cousins, not the same prop.** No shared contour language:
the intact silhouette lumpy and irregular, the wreck's a smooth clean arc; nine circles against
two dots.

**4 · Rubber-hose ink?** Weight genuinely varies — thin across the upper left, swelling through the
lower right. "That is brushed, not CAD. Good." But the swell arrives abruptly and reads as a
separate lobe, and nine hard-edged circles is a lot of interior incident for the idiom.

**5 · Black and white? Yes. Clean.**

**6 · Artefacts.** **Rosette / hexagonal packing** — one central circle ringed by neighbours in an
offset lattice at near-uniform gaps, "the exact named tell"; radius variation present but not
enough to break it. Push to a 2:1 spread and let eggs occlude each other. **The top ellipse closes
into a ring** floating clear of the mass — a halo, a hat brim, a handle, not an opening. **The base
contour fuses with the ground shadow** at bottom centre: at real size the sac has no visible bottom
edge and melts into the floor. **Mechanically regular sawtooth** on the wreck's rim. The wreck's
flap reads as a detached ring — a coin, a monocle.

**7 · Real size.** Base and shadow fuse. The white gaps between eggs are ~3 px and grey out, so the
cluster collapses toward one dark mass — "which is what makes it read berry instead of many eggs."
The wreck's two interior dots nearly disappear.

**Fine, do not break:** the black-and-white discipline; **the value contrast between intact (heavy,
dark) and destroyed (light, open)** — "the single best decision on the sheet"; brush-varying contour
weight; a contour bold enough to survive real size; and that it is neither a rock nor a bush.

---

## Rounds 10 to 12 — what changed

- **The lattice is broken properly.** Varying the gaps was not enough. The radii now run 2.2:1
  (12 down to 5.5) and neighbours overlap anywhere from 0.6 to 5.9 units, so some eggs frankly
  occlude others and no two gaps match. Uniform spheres at a uniform pitch are fruit whatever the
  outline round them does.
- **The splat is drawn under the sprite, not over it.** That single reordering is the whole fix for
  the fused base: the sac's own bottom contour now lands crisp on top of the shadow, and what shows
  is a dark spread around the base rather than ink meeting ink. It also answers the *first*
  reviewer's opposite note — the sac still sits in the spread rather than floating above it.
- **The membrane is measured across each sample's whole arc**, not just along its axis. An egg
  sitting between two sample directions was under-measured, so the skin closed over it — which at
  96 px does not read as a bulge, it reads as the contour breaking across an egg. A tighter skin
  was tried first and was worse: it pinched into concave notches between eggs, and a nick in the
  intact outline reads as a tear, which is the one thing the other variant is for. The generous
  band that came out of backing off is also the answer to *berry*: a visible skin standing off its
  contents reads as a bag containing them.
- **The sawtooth varies in pitch as well as height.** Widths now run 6, 13, 6, 5, 14, 5, 9, 9. Only
  the amplitudes had been varied, and an even pitch is still a stamped zigzag.
- **Three survivors in the wreck, at three heights, not two side by side** — enough to say it used
  to be full, and no pair of eyes over a mouth.
- **The flap is solid ink.** A pale flap with an ink contour encloses a white core, and a small
  closed loop beside the sprite is a coin, not torn membrane.
- **The vent clears the top contour** and the topmost eggs now overlap its near rim, so it cuts into
  the mass instead of floating above it as a hat brim.

Declined, with reasons:

- **Inverting the value logic so the sac is black and the eggs pale.** It would kill the berry read
  outright, and it would also kill the thing all three reviewers rated the best decision here: the
  wreck is legible at a glance *because* intact is heavy and dark and destroyed is light and open.
  Trading the pair's separability for one variant's first impression is the wrong trade.
- **A leg or an emerging spider.** The fastest possible "spiders come out of here", and also new
  content — #81 asks for the sac intact and destroyed, and ADR 0001 forbids anything beyond what was
  asked. The opening carries it.
- **A terminator line separating top surface from front face.** That is interior detail, which #76
  §1 rules out. The vent crescent is the top surface.
- **Outlining the eggs rather than filling them.** More brush-like, but #76 §1 asks for solid fills,
  and outlined eggs at this size put three concentric strokes into a 20 px circle.

Still unresolved, and shipping anyway per ADR 0002 §3:

- **Panel 3 magnifies only facing 0**, so the destroyed variant has never been inspected at real
  baked pixels — only at 2× on the contact grid and at real size on the floor. All three reviewers
  said so unprompted. Nothing on the sheet can currently show it; the final call is made by looking
  at it in the game.
- **The eggs carry more contrast than the contour.** All three reviewers noted it. They are also the
  only thing that says *brood*, and every fix for it trades against the value contrast that makes
  the two states separable.
