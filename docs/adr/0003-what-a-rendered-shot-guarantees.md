# ADR 0003 — What a rendered shot guarantees, and for whom

- **Status:** Accepted
- **Date:** 2026-07-26
- **Applies to:** every shot the game draws, from Milestone 5 onward
- **Supersedes:** the invariant as stated in [#81](https://github.com/ericbstie/the-game/issues/81),
  raised in [#85](https://github.com/ericbstie/the-game/issues/85)

## Context

Milestone 5 states a hard constraint:

> Rendering a shot must never imply damage the server did not apply.

For **peer** shots and **turret** shots it holds structurally. `PeerShot` is constructed at exactly
one site in the repo — inside `applyAttacks`, beside the HP write, fed only from `pendingAttacks`,
which is filled only on a truthy `admitAttack`. A refused attack has no path to the wire.

For **your own** shot it does not hold, and cannot, because of a separate rule that is also correct:
[#74](https://github.com/ericbstie/the-game/issues/74) §5 settled that own shots are **never
round-tripped**. `applyMapDelta` drops the shooter's own echo by design, so the line appears the
instant you click rather than a tick later, on the sprite you were actually looking at.

The consequence is unavoidable: **the client never learns the server's verdict on its own shot.**
It cannot know whether the shot was admitted, and it cannot know what it struck.

An invariant documented as absolute but true for only two of the three shot sources is worse than a
narrower one stated honestly. Either the gap closes or the words change.

## Decision

**1. The invariant is narrowed to what is actually guaranteed.** It now reads:

> A shot line drawn for a **peer** or a **turret** is always a shot the server admitted and applied
> damage for. A shot line drawn for **yourself** is optimistic: it depicts the shot you asked for,
> at the moment you asked for it. It never depicts what it hit.

**2. Own shots stay un-round-tripped.** Round-tripping would buy exactness at the cost of putting
input latency on the single most frequent action in the game. That trade is worse than the problem;
#74 already settled it and this ADR does not reopen it.

**3. Your own line therefore draws to full `RANGED_RANGE`, and this is correct rather than
merely tolerated.** Terminating it on a locally-raycast target would mean re-implementing an
authoritative rule client-side against enemies rendered `ENEMY_RENDER_DELAY_MS` behind — so it could
terminate on a *different* enemy than the server damaged. A line that stops on a sprite **implies a
hit**; a line that passes through to full range implies only a direction. Under this invariant the
full-range line is the safer drawing, not the lazier one.

**4. Where a refusal is knowable client-side, it is gated rather than drawn.** The client cannot
approximate the server's rules, but it can decline to guess when it already knows the answer:

- **The cadence** is enforced client-side as well as in `admitAttack` (#74).
- **Death** is enforced client-side and, authoritatively, on the server. `gameAttack` now refuses an
  attack from a player whose last reported HP is 0. Nothing was checking this: a dead player has not
  moved, so the anti-teleport position check passes and the shot was applied *and* drawn. A corpse
  could kill things.

**5. Anything not knowable client-side is accepted, and named here.** One case remains: the client
raycasts nothing, but the server resolves against live enemies while the player was looking at
enemies rendered 50 ms behind. Since your own line does not depict what it hit (decision 3), this is
invisible — it can change *what dies*, never what is drawn.

## Consequences

- The words and the code agree. The rendering invariant can be relied on for peers and turrets, and
  is explicitly optimistic for the owner.
- "Does the server allow this?" is now a question with two client-side answers (cadence, death) and
  one deliberate non-answer (which target). A future gate belongs in the first group only if the
  client can know it *exactly* — approximating a server rule client-side creates the divergence this
  ADR exists to bound.
- The teleport-aim window that #85 described is closed by construction rather than by timing.
  `reviveSelf` and the position send happen in the same interval callback, position before any click
  can be processed; the death gate now covers the whole interval before it, which is when a player
  waiting to respawn would otherwise have been clicking.

## Amendment — turrets spend ammo (2026-07-29, [#102](https://github.com/ericbstie/the-game/issues/102))

A turret now fires a bullet out of the squad's shared pool and holds its fire when the pool is
empty. That is a firing precondition the streamed `(target, powered)` transition does not carry, so
the invariant in decision 1 no longer holds for turrets exactly. It now reads:

> A shot line drawn for a **turret** is a shot the server admitted and applied damage for, except
> that the pool it spends from is mirrored a tick behind. No more turret trains are drawn in a
> frame than that mirror has bullets, and at zero none is.

Two cases, both named rather than closed:

- **A bullet forged and fired on the same tick never shows as spendable**, so the train is withheld
  over fire that did happen. This under-draws, which is the safe direction: no line is a missing
  depiction, a line is a claim.
- **Which turret got a scarce bullet is a guess.** The count is right and the trains are real shots,
  but with three bullets across five ready turrets the three drawn may not be the three that fired.

Closing the second needs per-shot turret events on the wire, which #74 §5 traded away deliberately
and this ADR does not reopen. It is left open because it misattributes a shot rather than inventing
one: the count is what decision 1 is about. Ammo is not in the transition because it would put an
aim delta on every engaged turret each time the pool crossed zero — routine in the scarce regime
#102 designs for — on a field whose value is that it is sparse.
