# `reconnecting` — review notes

The HUD's "the socket dropped and the client is trying to get back in" icon.

This sprite exists because of a decision, not a charter. #81 listed the "Reconnecting…" banner as
an open question — it is in-match text and not on the allowlist, so the rule removed it, but it
reports a real condition. The answer recorded on #81 was that it **earns an icon**: same treatment
as the under-attack bell, same place in the HUD. This is that icon. It is the only sprite in the
set with no row in `README.md`'s table, so every choice below was open.

## The calls

| Call | Chosen | Why |
| --- | --- | --- |
| Name | **`reconnecting`** | Added to `SpriteName`; every other sprite name already existed. |
| Box | **28** | The same box as `warning`, because the two sit side by side in the same HUD plate and a mismatch would read as a mistake. |
| `facings` / `frames` | **1 / 1** | One state, and the flash is CSS like the bell's. |
| Subject | **A chain link snapped in two** | See below. |

## Why a broken link

It has to mean *a connection*, not *a fault*. The candidates that mean "fault" — a cross, a slash,
a bolt — either say the player did something wrong or collide with an icon already spoken for:
the hollow lightning is the unpowered turret's, in the world.

A chain link is a connection drawn as an object, and breaking it is the whole message in one
silhouette. It is also the reading that survives being 24 px and blinking.

## What the sheet showed

First bake overran the box on the diagonal: the link's two halves plus the gap came to 16.6 from
centre against a half-box of 14, so both round caps were clipped. Reach came down from 8.8 to 6.3
and the height from 4.3 to 3.9; the bake now covers 48×42 inside the 28 box with no edge warning.

The two ticks flying off the break were also moved. Set out at ±(3.4, 6.6) they landed against the
inner ends of the halves and read as stubs growing off them; at ±(1.0, 5.8) they sit clear of both
and read as the snap they are.

Butt caps, deliberately — a snapped end is torn and flat. Round caps made the halves read as two
whole links that had merely failed to meet.

## Review

Reviewed once by its author against the sheet at dpr 2 and in a real frame of the game, per the UI
ticket's instruction to look once rather than run ADR 0002's per-sprite review loop.
