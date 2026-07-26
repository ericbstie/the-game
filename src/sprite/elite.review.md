# elite — review

Produced under [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)
and [`docs/sprite-loop.md`](../../docs/sprite-loop.md): a subagent looked at `elite.sheet.png` and
reported, four times. Its findings are **advisory**; what was done about each is recorded beside it.

## Calls this sprite made that nothing fixed for it

- **A leg has a knee.** Four rounds proved that a single unbroken curve reads as a tentacle however
  well it tapers and however the body is proportioned. Two hoses meeting at an angle — thigh out
  and up off the flank, shin down to a planted foot, the joint the thickest point on the limb — is
  what says arthropod. It is still rubber hose: a bend in the tube, not a mechanism. The grunt
  agent reached the same conclusion independently on its own round 4.
- **A knee is placed clear of the body before the leg is allowed to rise.** The clearance is wider
  than the knee is thick, so white always separates flank from limb. Without that rule eight legs
  sinter into one horizontal bar and the creature grows shoulder pads.
- **Every leg leaves the flank at its own point.** The four legs on a side are ranked back to front
  and parted down an arc of flank. Eight legs leaving one point is one leg as far as a silhouette
  is concerned.
- **The leg splay's depth is compressed into one narrow band.** #76 puts the legs on a floor seen
  straight down. Taken literally at 48 px, half the feet land *behind* an upright body and are
  swallowed by it. Bearing still sets each foot's lateral position honestly — which is why two legs
  the same angle fore and aft share a column and part only in depth, as they do in a real profile —
  but the depth itself is squeezed, so all eight feet land in one band clear of the body. That is
  the one liberty taken with the projection, and it is what makes the creature read as standing.
- **The creature is centred on its position, not stood on it.** The ring of feet *is* the floor
  contact, so the ring is centred in the box and the body rises out of it. Foot-anchoring at the
  bottom edge is for things that stand on two legs.
- **Nothing is exactly mirrored.** The bearings carry a skew that is not mirrored, the body sits off
  the box's centre line, and every leg has its own reach, rise, clearance and knee ceiling.

## Round 1 — "an ant, and the legs are drips"

Sheet: a two-lobed body with eight legs hanging off its lower contour.

> It reads as an ant or a black bean at E/W… At index 0 and 4 the silhouette is two black circles of
> nearly equal size joined at the waist with a few drips underneath. That is the universal shorthand
> for an ant thorax+abdomen, not a spider. […] I cannot count eight. I can count four, and often
> two. They read as drips/icicles — no arch, no outward reach, no planted foot. The body appears to
> be melting. […] The white crescent between abdomen and head reads as a specular shine, not an
> occlusion edge. […] **Frame 0 does not read as a standing pose.**

**Changed:** legs rebuilt to arch clear of the silhouette; the keyline deleted; the lobes made
unequal; the near lobe drawn over the far one so S and N invert; frame 0 made the planted stance.

## Round 2 — "an octopus, and it deflates"

> **Octopus.** Every limb is a single unbroken arc that leaves the body and hangs. […] Six of the
> eight never reach the floor. […] Facings 2 and 6 share a silhouette — a player cannot tell whether
> this is coming at them or walking away. Facings 5, 6, 7 carry no directional information at all.
> […] The profile eye reads as a glint; the SE/SW pair fuse into a bow tie. […] Frame 1 loses ink on
> every facing: it reads as a pulse, not a stride.

**Changed:** the knee introduced; feet moved into one band below the body; the counter-pose fixed so
neither frame is the fuller one; the eyes cut down to slits, with the far one dropped rather than
squeezed into its neighbour; spinnerets added as a rear-only silhouette cue.

## Round 3 — "no knee in the image, and slabs"

> No knee is visible anywhere. […] Flat horizontal slabs stick out of the top of the body on facings
> 0, 4, 5 and 7 — they read as shoulder pads or a cape, not as limbs. […] The feet do not land on any
> floor line.

**Changed:** the thigh forced to leave a low hip and climb; the knee capped below the body's
shoulder; the knee clearance widened past its own thickness; and the joint given a round cap — an
offset polygon turning that corner comes out square, and a square block on a rubber-hose limb reads
as furniture.

## Round 4 — "the roots are one curtain, and the rear facings grew a mouth"

Answers to the three questions put directly: **A. Octopus. B. Yes, mass reads. C. No** — the
reviewer opened the shipped grunt sheet to check and found "zero confusion risk. Do not weaken the
mass to fix anything else."

> **The knee still does not exist in the image.** On panel 3 the far-side knee is a rectangle welded
> flush to the body. […] **Legs are one curtain, not eight limbs.** Countable strand groups: 3, 2, 3,
> 2, 2, 4, 3, 4 across the facings — never 8. The roots merge into a single horizontal black bar
> spanning the full body width, with zero white between flank and limb. […] **Accidental face on the
> rear facings — the worst artefact in the sheet.** Two to four small downward spikes under a plain
> round dome, flanked by symmetric leg curtains, read as teeth in a blank face. Facing 6 reads as a
> face with two fangs staring at you. […] **There is no stride** — frame IoU 0.81–0.90; the body mass
> does not move at all. […] The eye is a plain white ellipse: in flat-fill ink a bare white hole
> reads as a specular highlight or a puncture. […] Facing 2's two-eyes-two-fangs arrangement reads
> as a jack-o'-lantern.

**Changed:**

| Finding | Change |
| --- | --- |
| Roots merged into one bar; 2–4 legs countable | Every leg now leaves the flank at its own ranked point along an arc, and the root is narrowed so white traps it on both sides. |
| The knee is a welded rectangle | Round cap at the joint, and the clearance widened past the knee's own thickness so it stands in white. |
| Spinnerets read as teeth in a face | **Deleted.** Measured after: the rear facings now hold 5, 0 and 0 enclosed pale pixels between them, against 124, 47 and 64 before. |
| No stride — the body never moves | The mass drops a pixel as the leading tetrapod takes the weight, and the two tetrapods now take opposite ends of the stride. The previous code swung both the same way, which is why it read as a twitch. |
| S and N share a silhouette | The lobes made plainly unequal, so approach puts the wide mass high and the narrow one low, and retreat inverts it. |
| The eye is a white hole, so it reads as a highlight | It has a pupil. |
| Two eyes plus two fangs read as a jack-o'-lantern | The fangs are gone. Two marks, larger, as the reviewer asked. |
| Feet thin enough to shimmer under sub-pixel motion | Foot width floored at 1.8 CSS px. |

Not taken: **outlining the eye**. At this size an outline around a 6 px eye is a sub-pixel stroke,
and #77 measured what those become — grey, not ink. The pupil does the same work with a mark that
survives the bake.

## Measured, not eyeballed

Two checks copied from the player agent, run on the real-size bakes off panel 2:

- **Every bake is a single connected ink mass** — except for the pupils, which are black islands
  inside the white of the eye and are meant to be.
- **Enclosed pale pockets are counted** by flooding the background in from the border. What is left
  is the eyes and their surrounds on facings 0–4, plus specks of 2–6 device pixels. This is the
  defect that dogged the grunt through every one of its rounds — white pockets at the leg joint that
  fill with anti-aliasing and grey out exactly where the silhouette lives — so it is measured here
  rather than looked for.

## Standing, on the record

The reviewer's remaining objection is that the limbs still do not read as jointed to it at 2×. Four
rounds moved the sprite from "an ant" through "an octopus" to a creature whose body mass is
unmistakable, which is the thing #76 asks this sprite to carry: *silhouette alone must separate the
elite from the grunt*, and the reviewer confirmed it does, twice, against the shipped grunt sheet.
The final call is made by looking at it in the game.
