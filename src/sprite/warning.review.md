# `warning` — review notes

The HUD's "a structure is under attack" icon. Produced by the UI agent rather than a dedicated
sprite agent, because #76 §6 gives the UI agent every screen *and* the in-match HUD, and this icon
has no call site anywhere else — `drawWorld` never sees the HUD.

## The calls this sprite had to make

`README.md` marks the box, and only the box, as "your call" for this one.

| Call | Chosen | Why |
| --- | --- | --- |
| Box | **28** | The player's box, and the smallest thing in the set that still reads. A HUD icon has no size fixed by #81, and matching the player keeps the HUD's ink weight the same as the world's. |
| `frames` | **1** | The flash is CSS (`.signal`, a `steps(1)` opacity keyframe), not a second bake. Two frames would put an animation clock in the HUD to blink one element. |
| Subject | **An alarm bell, mid-swing** | See below. |

## Why a bell and not a warning triangle

The obvious icon is a triangle with an exclamation mark in it. That mark is a **letterform**, and
ADR 0001 removed text from this game thoroughly enough that reintroducing punctuation as an "icon"
would be the same habit in a costume. A bell is a drawn object, it is period-correct for a 1930s
cartoon, and it says exactly what #76 grants this icon and nothing more — *something* is under
attack, with no direction and nothing named.

The swing is baked into the one frame rather than animated. A bell standing upright reads as a
doorbell; one caught at the end of its arc, with ring arcs either side, reads as ringing even
during the half of the flash cycle when it is dimmed.

## What the sheet showed

First bake ran into all four edges of its box — the ring arcs were at radius 13.6 in a box whose
half-width is 14, so the outer arc was being clipped on both sides, and the lip's lower corner
dropped out of the bottom under the tilt. Radii came down to 10.4/12.4, the lip narrowed, and the
tilt eased from 0.14 rad to 0.11. Second bake covers 54×47 inside the 28 box with no edge warning.

Ink is 70% of covered pixels, which is the expected share for solid rubber-hose ink at this size
and not a sign of a thresholding problem (see README, "Do not 'fix' the anti-aliasing").

## Review

Reviewed once by its author against the sheet at dpr 2, per the UI ticket's explicit instruction
to look once and move on rather than run the per-sprite review loop ADR 0002 sets out for the
thirteen world sprites. The two HUD icons are small, single-frame, and were checked in a real
frame of the game as well as on the sheet — the flashing plate in the top-left of the HUD.
