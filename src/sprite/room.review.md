# room — review

The arena's perimeter wall and the escape door. Six drawings, one completed review round (ADR 0002
§3). The reviewer is advisory; what it said is recorded whether or not it was taken, and the places
where it was overruled say why.

## What was decided, and why

**The unfolded box is one drawing and four rigid rotations.** #76 §2 makes the perimeter the single
exception to the game's orthographic projection: the walls lean away from the middle of the arena
and lie flat, like a carton cut at the corners and pressed open. So `draw` works in *wall space* —
`u` along the perimeter, `v` from the wall's top edge (0, outermost) to its base (30, where it meets
the floor) — and `UNFOLD` turns it onto each edge. All four matrices have determinant +1: they are
rotations, never mirrors, so it is one rigid wall shown four ways rather than four drawings that
happen to agree. The consequence a player sees is that the heavy band is at the **top** of the
screen on the north edge and at the **bottom** on the south — the opposite of every other sprite in
the game, and the thing that makes the four edges read as one room. The reviewer confirmed
`west == rot90(north)` pixel for pixel, and that nothing is flipped wrong.

**The mass is outboard and the face is light.** The cornice is 12 of the 30 px and sits on the far
side, which is the boundary of the play space and the half nobody's feet reach. The face is paper
under hatching, so ink entities still read against it.

**The band is opaque corner to corner** — no transparent pixel. Two reasons: it joins the Y-sort, so
the near wall has to actually cover a player standing against it; and the run pushes both a north
and a west segment into the same box at each corner, where an opaque second segment covers the first
instead of crossing it into a mesh.

**Nothing in the drawing has a period of 30 except the pier, which is meant to have one.**
`wall.review.md` established the rule for a sprite laid in runs: anything that varies along the run
becomes the same accident every 30 px. Every band here therefore runs the full length and continues
straight through a join, and the hatch's pitch divides the box, so the stroke a neighbour starts at
its own column 0 is the next member of this one's family rather than a second stroke beside it. The
pier is the deliberate exception — see round 1.

**It must not be read as a buildable wall.** That sprite shares the 30 px box and will often be on
screen beside it. It is masonry: a *light* field of white bricks in a staggered bond at pitch 10,
44% ink. This is its inverse — 72% ink, a solid black cornice over a hatched grey face, and no bond
anywhere. The reviewer checked this and called it clean: "on screen together you would never confuse
them."

## The face, and the three drawings thrown away before it

The failure mode repeated three times and is worth writing down: **30 px of depth leaves room for
horizontal bands or for one row of marks along the run, and a single row of identical marks under a
heavy black band is a manufactured product, not a wall.**

1. **Panelled dado** — a 7 px cornice, a rail, and battens closing the face into small white cells.
   As a butted run it read as **sprocket holes in a strip of film**. A mark that bounds a cell makes
   a cell; a mark has to terminate in white.
2. **Scribe lines** — the battens cut free of the skirting. They read as a **comb**, and the band was
   far too light: a 7 px cornice on a mostly white band is a decorative rule, no heavier than the
   moulding round a page. The cornice went to 12.
3. **Upright hatching with cycling stroke lengths**, meant to give the shadow a ragged edge. It read
   as a **measuring tape** — and the length variation made it a *better* ruler, not a worse one,
   because varied tick lengths is exactly what a ruler has.
4. **Diagonal hatching**, which ships. A diagonal is the one direction the box's own axes do not
   offer, so it resolves as a shade rather than as its strokes. That is what makes the face read as a
   lit vertical surface instead of as the gap between two rules. Hatching on a large structure is
   granted by #76 §1, and this is the largest structure in the game.

The hatch strokes are the only ink here that is not axis-aligned, so they are the only ink that
anti-aliases. That is deliberate: the grey is the tone.

## The door

The exit is **936 world units along its wall**, so the door variant is tiled about **31 times in a
row**. One drawing of a door leaf would read as 31 doors. It is therefore a plate that tiles into
itself: solid ink, crossed by one white strap in each axis, so any number of them butt into one long
panelled gate. It is solid ink for its outer and inner 13 rows, so the wall's cornice and its ground
line **carry straight through the door** rather than terminating at the jamb — which is what stops
it reading as a hole. Its ink coverage was tuned to sit beside the wall's rather than above it, for
the same reason.

**It is symmetric under a quarter turn, and that is the one choice here made against taste.**
`drawWorld` asks for facing 4 whatever edge the exit falls on (`draw.ts`: the constant is
`ROOM_DOOR`, not `ROOM_DOOR + facing`), so an oriented door would be drawn sideways on three walls
out of four — and the demo world's exit is on the *west* wall, so this is not a corner case. A plate
with no top is the only door that survives that wiring. Seamlessness in both axes plus 4-fold
symmetry together force the drawing to be uniform apart from a centred motif, which is why it is
strapwork and not a lintel, a threshold and jambs. **The reviewer's first and strongest ask was for
exactly those three things**, and every one of them needs an orientation this sprite is never
handed. See the standing notes.

## Measured, not argued

Butted runs of 24 rendered at dpr 1 and dpr 2, plus ink profiles read off the bitmap.

- **The join cannot be located.** The eight columns spanning the first seam of a four-segment run are
  identical to the eight spanning the second, at both ratios: `22 21 21 21 21 21 21 21` at dpr 1 and
  `43 43 42 41 42 42 42 43` at dpr 2. The reviewer independently found tiles 0, 5 and 12 of a
  24-segment run bit-identical, with no seam visible at any magnification and no repeating stamp
  discernible across 720 px.
- **The run has a beat.** Column ink over one interior tile at dpr 1:
  `21 21 21 21 20 21 21 21 21 21 22 21 29 29 29 21 21 21 21 21 21 21 21 21 21 22 22 21 21 21` — the
  pier is the spike. Before the pier the same measurement was **constant**, which is what the first
  review caught.
- **The tonal ladder down the wall, dpr 1, top to base:** twelve rows of 100, then 10 · 23 · 45 49 46
  45 46 49 46 43 40 42 · 100 100 · 0 · 100 100 100. Black cornice, fillet, hatched face, skirting
  rule, skirting face, ground line.
- **dpr 1.5 was checked** (the README asks for it on a 30 px box). Every ink band boundary is even
  except the ground line's top edge, so one row picks up grey there. Accepted rather than shifting
  the band, because moving it flattens the cornice > ground line > skirting rule weight hierarchy,
  and uniform stroke width is the louder tell.

## Round 1 — a length of knurled metal edging

Shown the sheet and butted runs at both ratios, and the buildable wall's sheet for comparison.

**Verdict: fix these things first. Three of the problems are structural, not polish.**

Its blind first impression, before analysis: ***"a length of knurled metal edging / twill ribbon
trim — with a perforated grille plate spliced into the middle."*** Not a room. It confirmed the two
previously-killed readings were genuinely gone — no sprocket holes, no measuring tape — and said the
sprite had traded them for a new manufactured-product reading.

Its ranked problems, and what happened:

1. ***The door is a black rectangle with a dot grid — it reads as a hole.*** No frame, no jamb, no
   lintel, no threshold; and worse, it destroyed the wall around it, because the cornice, both rules,
   the hatch and the floor line all terminated dead at the door edge while the door stayed solid
   black through the full depth. It called that "the precise signature of a void". **Taken as far as
   the wiring allows.** The dot lattice became strapwork, and the plate's outer and inner 13 rows
   were made solid so the cornice and floor line carry through. The lintel, threshold, jamb posts and
   two-leaf seam it asked for all need an orientation and were **not taken**; they are in the report
   as a wiring defect.
2. ***The tile has zero vertical structure, so a run is a featureless extrusion.*** It measured
   per-column ink across the whole 720 px run and found it **constant at 204/255 for every single
   column** — "no rhythm, no beat, no scale cue, nothing that says built of things". **Taken:** the
   pier. This was the most valuable finding of either round, and it is the one thing I had reasoned
   my way *out* of, twice, because both earlier attempts at a rhythm failed.
3. ***The corner does not close — it's a T-junction, not a mitre.*** The north run's cornice starts
   flush against the west wall's floor rule, so the room's outer black outline does not turn the
   corner. **Not taken:** a mitre needs a sixth variant and a change to the caller. Reported.
4. ***The hatch is CAD linework*** — one width, one angle, one period, cut flush at both rules, "the
   single strongest generated-imagery tell in the sprite". **Taken:** alternating 1 px and 2 px
   weights, every third stroke overshooting the rule. It also asked that no 1 px hairline be left
   anywhere; **taken**, the moulding rule went and the skirting rule went to 2 px.
5. ***Resolution-dependent ink weight*** — the hatch measured 20% ink at dpr 1 against 28% at dpr 2.
   **Taken in effect**: the weight alternation closed it to 45% against 48%. The residue is a 1 device
   px diagonal losing mass at dpr 1 and is not fixable without making the hatch coarser; it is the
   "not enough pixels" case #77 says not to fight.
6. ***Door studs are the only soft thing in the sprite, and they're very soft*** — half of each 6 px
   dot anti-aliased. **Taken:** the strapwork is axis-aligned, so there is now no curve anywhere in
   the door and it is hard-edged at every ratio.
7. ***Perfect symmetry on the door.*** "A door that looks the same in all four facings can't be a
   door." **Not taken** — see above; it is the wiring.
8. ***Top-heavy hierarchy*** — a 12 px cornice against a 10 px face. Raised as low priority and left;
   the pier now carries the cornice down into the face, which is the same complaint answered
   structurally rather than by shaving the cornice.
9. ***The hatch flips 90° between N/S and E/W.*** It judged this defensible on its own as a genuine
   unfolded box and passed it, noting only that it compounds the corner. Left as is.

**Checked and found fine at round 1:** tiling ("the one thing the sprite nails — arguably *too*
well"); no drift between facings, `west == rot90(north)` pixel for pixel; facing orientation correct
on all four edges; no colour anywhere; no moiré at either ratio; wall tiles pure 1-bit at dpr 1; and
clearly distinct from the buildable wall — "on screen together you would never confuse them".

## Round 2 — asked for, not returned

The same reviewer was sent the re-rendered sheet and runs and asked six questions: a fresh blind
first impression, whether the pier reads as architecture or as a third member of the
sprocket/ruler/comb family, whether the door now reads as a gate, whether the hatch changes removed
the CAD read or only added noise to it, whether anything had regressed, and a verdict. **It did not
return within the time this sprite had.** ADR 0002 §3 makes the reviewer advisory and the author's
call final, so the sprite ships on round 1, whose nine findings are all either taken or answered
above. The round-2 questions are the first thing to put to a reviewer if this sprite is picked up
again, and the three changes they cover — the pier, the strapwork, the hatch weights — are the three
that have had no second pair of eyes.

Two things partly stand in for that. The changes were **measured** rather than eyeballed: the
per-column flatness the reviewer objected to is gone, the seam survived every change, and the
dpr 1 / dpr 2 tone gap closed. And each change was checked against the specific failure it was meant
to fix, in a butted run on white paper, at both ratios.

## Standing notes for whoever touches this next

- **Two things in this sprite are wiring defects, not art, and neither can be fixed from here.**
  1. **The door is handed no orientation.** `pushRoom` in `draw.ts` asks for `ROOM_DOOR` on every
     edge. Passing `ROOM_DOOR + facing` and raising `facings` to 8 is the whole change on the caller's
     side, and it is what buys the door a lintel, a threshold, jamb posts and a leaf seam — the four
     things both the first reviewer and any future one will ask for first. Until then the door has to
     be symmetric under a quarter turn, and a symmetric door is a weak door.
  2. **The corner is drawn twice, not mitred.** The run pushes a north segment and a west segment
     into the same box at each corner; the later one covers the earlier, so the room's outer black
     does not turn the corner and reads as a T-junction. A sixth variant drawn as a mitre, chosen by
     the caller for the four corner boxes, fixes it.
- **Do not put a row of marks along the run in the face.** Three attempts, three failures, all in the
  same family — sprocket holes, a comb, a measuring tape. Tone is what works there; the beat belongs
  in the pier, which is one mark per box and reads as structure rather than as graduation.
- **Do not straighten the hatch.** One width, one angle and a flush cut-off was measured by the
  reviewer as the sprite's loudest generated-imagery tell.
- **Do not lighten the cornice below 12 px.** At 7 px a butted run read as a decorative rule.
- **Do not make the door darker than the wall.** It was, and the reviewer called it the precise
  signature of a void. Its outer and inner 13 rows must stay solid so the cornice and the floor line
  carry through it.
- **Keep every band boundary on an integer**, and prefer even ones: that is what holds 0%
  anti-aliasing everywhere except the hatch, at every ratio.
