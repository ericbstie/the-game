# elite — review

Produced under [ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)
and [`docs/sprite-loop.md`](../../docs/sprite-loop.md): a separate subagent looked at
`elite.sheet.png` and reported. Its findings are **advisory**; what was done about each is recorded
beside it.

## Calls this sprite made that nothing fixed for it

- **The leg splay's depth is compressed.** #76 puts the legs flat on a floor seen straight down and
  the body upright. Taken literally at 48 px, four of the eight feet land *behind* an upright body
  and are hidden by it, which leaves a skirt of four hanging tubes — the octopus read. The bearing
  still sets each foot's lateral position honestly (which is why two legs fore and aft of the
  creature share a column and separate only in depth, exactly as they do in a real profile), but
  depth is squeezed into a shallow band below the body so all eight legs clear it. That is the one
  liberty taken with the projection, and it is what buys eight legs at every facing.
- **Legs arch above where they attach.** They leave the flank, rise outboard of the silhouette, and
  come down to a planted foot. Round 1 hung them off the body's lower contour instead, and the
  reviewer's verdict on that was "melting", "drips", "an ant".
- **The two lobes are deliberately unequal** — a big abdomen and a smaller face-carrying
  cephalothorax set lower and forward. Two circles of the same size read as an ant's thorax and
  abdomen, not a spider.
- **Nothing is exactly mirrored.** The four leg bearings per side carry a fixed skew and each leg
  its own reach, knee height and knee clearance, so the sprite has no axis of exact symmetry.
  Perfect mirroring is one of the tells ADR 0002 asks the reviewer to hunt for.

## Round 1

Sheet reviewed: a two-lobed body with eight legs hanging from its lower contour.

> **Does it read as a spider?** No. It reads as an ant or a black bean at E/W, and as a
> beetle/tick shell at N/NE/NW… It is a two-ball insect. At index 0 and 4 the silhouette is two
> black circles of nearly equal size sitting side by side, joined at the waist, with a few drips
> underneath. That is the universal shorthand for an ant/bee thorax+abdomen, not a spider.

> **Legs.** I cannot count eight. I can count four, and often two. […] They read as drips/icicles.
> Every leg descends straight down from the body's lower contour with no arch, no outward reach, no
> planted foot. Nothing is holding the creature up; the body appears to be melting. […] They are
> not drawn as legs at all; they are negative space subtracted from the body mass. The separations
> are sharp white triangles with hard points… those triangles read as nicks and damage.

> **Artefacts.** The white crescent between abdomen and head reads as a specular shine, not an
> occlusion edge. This is the exact "unintended highlight" failure. […] On indices 5, 6 and 7
> (which have no face) it is the only interior mark, so the sprite reads unambiguously as a glossy
> black balloon with a highlight on it. It also tapers to nothing at both ends — a line that fades
> out mid-stroke is the signature of an accidental sliver, not a drawn edge.

> **Facing consistency.** Index 2 (S) and index 6 (N) have nearly the same silhouette… A player
> cannot tell whether this thing is coming at them or walking away. Indices 0 and 4 are 4 world px
> shorter than every other facing… Indices 5, 6, 7 are dead.

> **Movement.** It reads as a pulse, not a stride. Frame 1 is bigger than frame 0 in every
> dimension on every facing… Legs appear and vanish… **Frame 0 does not read as a standing pose.**
> At index 0 frame 0 is the *most* collapsed pose in the set.

> **The face.** It does not read as eyes at E, W, NE, N, NW. It reads as a highlight. A single
> white ellipse, no pupil, soft edge, placed high on the outward curve of a black ball — that is
> where you would paint a specular highlight. […] At index 2 the two white triangles plus the white
> bay below them read as a jack-o'-lantern grin, and it hollows the silhouette.

Passing cleanly: **black and white** (verified, 256 greys, zero non-greyscale pixels), and **body
mass beats the grunt** — "it cannot be confused with a long-legged grunt" — though the reviewer
noted it won that for the wrong reason, the legs having shrunk rather than the body impressing.

### What changed

Every must-fix was taken.

| Finding | Change |
| --- | --- |
| Legs hang, read as drips; four visible at best | Rebuilt. Each leg now arches — flank → knee outboard **and above** the attachment → planted foot on the floor band. All eight clear the silhouette at all eight facings. |
| Legs are negative space cut out of the body | They are drawn shapes behind the body, not gaps in it, and the gaps between them are the wide rounded lozenges left over. |
| Uniform-width tubes | The width swells at the belly of each curve and tapers to a rounded foot, which is what rubber hose *is*. |
| The white crescent reads as a shine | **Deleted.** The two lobes are now different enough sizes that the outline alone carries the overlap. |
| Two equal circles at E/W read as an ant | Abdomen 11×10, cephalothorax 8×7.5 and set lower and forward of it. |
| S and N share a silhouette | The near lobe is drawn over the far one, so S puts the small face-lobe **below** the big hump and N puts it **above**. Opposite silhouettes. |
| Frame 1 is bigger everywhere; legs appear and vanish | The body no longer bobs and the foot ring no longer stretches. Only the gait phase differs: half the legs swing forward and plant, the other half swing back and lift clear of the floor. Same eight legs in both frames. |
| Frame 0 is the most collapsed pose | Frame 0 is now the neutral planted stance — every foot down, at its neutral bearing. Frame 1 is the one that breaks symmetry. |
| One eye reads as a specular highlight | The eyes are narrow tilted slits, not rounds. An elongated angled slit cannot be mistaken for a glint. |
| The mouth is cut through the bottom contour | The fangs sit well inside the head and no longer break the silhouette. |
| E/W are shorter than the other facings | The cephalothorax now sits lower than the abdomen at every facing, not only when it is the near mass, so the profile is no longer the short one. |

Not taken: **giving the eyes pupils**. At 48 px a pupil inside a 6 px eye is a sub-pixel mark at
real size, which the harness's own findings (#77) say degrades to a grey smear rather than reading
as ink. The tilt does the same work with a mark that survives.

## Round 2

_See below — recorded after the rebuilt sprite was re-rendered and reviewed again._
