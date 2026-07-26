# Unpowered — review notes

The sprite is `src/sprite/unpowered.ts`; the sheet is `src/sprite/unpowered.sheet.png`.

It arrived differently from the other thirteen. It was built by the ticket that finished the
in-world render layer rather than by a dedicated sprite agent, on an explicit instruction to spend
**one** review round rather than the per-sprite loop
([ADR 0002](../../docs/adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md)) — the art
is good enough to iterate on later, and this ticket is plumbing. So this file records two rounds,
not five, and the reviewer was the author looking at the sheet.

## What the brief fixed, and what it left open

Fixed: a **flashing hollow lightning bolt**, black ink, over a turret holding a target it has no
power to fire on. `drawWorld` owns both the predicate (`target !== null && !powered` — an idle
turret is unpowered too and has nothing to complain about) and the flash rate (`FLASH_MS`, 400 ms).

Chosen here:

- **`size: 24`** — the ticket's range was 20–24. The turret is 30 and the overlay is centred on its
  footprint, so 24 is the largest box that still leaves the building visible around the mark. It is
  also what the hollow needs: the interior has to survive at dpr 1, and the smaller the box the
  sooner the two edges of a contour meet in the middle.
- **`facings: 1`** — nothing about it varies.
- **`frames: 2`**, the second empty. See the contradiction below.

## The two rounds

**Round 1 — `CONTOUR` 2.2 inside a 3.8-wide limb.** The bolt read as **solid**, not hollow. The
arithmetic says why and it is worth writing down, because it is the whole design constraint: the
contour is stroked *on* the outline, so it eats `CONTOUR / 2` inward from each side and leaves
`limb − CONTOUR` of interior. At 3.8 and 2.2 that is 1.6 logical px, which rounds away.

**Round 2 — fatter limbs, thinner line.** The limb went to ~4.9 (bolt widened from 10 to 12 across)
and the contour to 1.8, leaving ~2.8 of white — 5–6 device px at dpr 2 and a surviving channel at
dpr 1. Checked at both ratios; the hollow reads at each. Accepted.

The three widths — limb, contour, paper gap — are one decision and not three. Anyone changing the
box has to re-derive all of them or the bolt fills in again.

## Why it is drawn the way it is

Each of these comes from what it sits on top of rather than from the bolt itself:

- **Hollow because the turret is not.** The turret is a bold ink contour around a white roof. A
  solid black bolt laid on it merges into that contour and reads as a fitting. Same grammar, so the
  bolt reads as a *mark on* the building.
- **It carries its own paper gap.** The knockout is a second, fatter pass of the identical path in
  white, laid down first. Ink on ink at this size is a blob; the gap is what keeps the two drawings
  apart where the bolt crosses the roof edge or the bore ring.
- **It stays inside the turret's top line.** The ink starts just below the casemate's flat roof edge
  and stops short of the floor. Anything above that line reads as a mast — a permanent piece of the
  building — and a permanent protrusion is the **miner's** distinguishing feature. Two 2×2
  structures cannot share their one distinguishing silhouette.
- **Tilted ~5°, limbs not mirrored.** At 24 px an even-weight contour is accepted, so this is what
  is left to keep it from reading as a flat UI glyph struck onto the frame.

## Contradicts the ticket

The ticket asked for **`frames: 1`**. It cannot be 1. `drawWorld` passes `floor(now / FLASH_MS)` as
the frame index and the cache wraps it modulo `frames`, so a single-frame sprite is on screen
permanently and does not flash — which #81 requires it to do. `src/sprite/README.md` already says
`unpowered` is `2+ — it flashes, one frame per 400 ms`, and `draw.ts` and its test were both written
to that. So: **`frames: 2`, and frame 1 is deliberately empty** — the flash *is* the mark coming and
going.

The consequence is that `sprite:sheet` reports `1 bake(s) drew nothing at all`. That warning is
correct and expected here; it is not a defect to chase.

## Not done

- **No second flash state.** Alternating between two drawn weights was considered and dropped: a
  blink is what "flashing" means, and a symbol that is always present in *some* form is a worse
  warning than one that is intermittently absent.
- **No colour.** #76 grants two exceptions and this is neither.
- **The anchor was not moved.** `drawWorld` centres overlays on their box (`blitOver`), and the mark
  was sized to that rather than the other way round.
