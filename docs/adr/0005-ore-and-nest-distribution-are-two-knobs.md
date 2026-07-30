# ADR 0005 — Ore distribution and nest distribution are two knobs, not one

- **Status:** Accepted
- **Date:** 2026-07-30
- **Applies to:** `WorldSettings`, and every later control built on it
- **Decides:** the open question stated in
  [#127](https://github.com/ericbstie/the-game/issues/127), inherited from
  [#97](https://github.com/ericbstie/the-game/issues/97) and from #96's constraint list

## Context

#97 lists the exposed knobs of a world, and lists exactly one for distribution: `EDGE_BIAS 3.5`.
#96's constraints go further and say it is shared with nest placement.

It is not. Before this change there were **two** constants:

- `build.ts`'s `EDGE_BIAS = 3.5`, module-private and unexported, read by `patchSeedTile` to draw a
  patch centre at `ORE_MIN_FRAC + u ** (1 / EDGE_BIAS) × (ORE_MAX_FRAC − ORE_MIN_FRAC)` — a fraction
  of the **whole arena** half-extent, from 0.02 out to 0.96.
- `enemies.ts`'s `NEST_EDGE_BIAS = 3.5`, read by `nestLayout` to draw a nest at
  `NEST_BAND_INNER + u ** (1 / NEST_EDGE_BIAS) × span` — a fraction of the **nest band**, from
  3,600 u out to 14,352 u.

Same curve, same exponent, two declarations, moving independently. Exposing "ore distribution"
forces the choice #97 could not make: one control that moves both, or a dial each.

## Decision

**Two knobs.** `WorldSettings` carries `oreEdgeBias` and `nestEdgeBias`, both defaulting to 3.5.

### What decided it

**The repo has already ruled on this shape, twice, and ruled the same way both times.**

- [#93](https://github.com/ericbstie/the-game/issues/93) gave the door its own reveal radius rather
  than reusing the sim's aggro radius, and said why in `world.ts`: *"Its own number on purpose: it is
  the same 1,800 as `AGGRO_RADIUS` today, and retuning how far a spider notices you must not quietly
  change how hard the door is to find … a shared value would only look independent."*
- [ADR 0004](0004-nest-layout-is-derived-from-a-seed.md) gave the nest layout its own seed rather
  than reusing `oreSeed`, for 22 B: *"They are independent worlds, and a retune of ore generation
  must not silently move all fifty nests."*

Welding the two biases together would undo ADR 0004's reasoning through a different field. The seed
decision already says a retune of ore generation must not move the nests; a shared bias would make
it move all fifty.

**Equal exponents are not equal distributions.** The two are sampled over different spans, so 3.5
does not even mean the same thing on both sides — it puts ore across the whole box with a floor at
2% of the half-extent, and nests inside a band that starts at two aggro radii. A single control
would read as "how far out is everything", and would in fact be two different retunes at once.

**They answer different questions.** Ore distribution asks how far the squad must push to get paid.
Nest distribution asks how far it must push to meet the danger. The interesting worlds are exactly
the ones where those two answers differ — riches near the wall with the nests close in, or an empty
dangerous rim — and one knob cannot express either.

### What it costs

Two sliders in #129 instead of one, and a squad that wants "everything pushed outward" moves two of
them. That is the price of being able to move one without the other, and the cheaper direction to be
wrong in: two knobs can always be turned together, one knob can never be split after the fact.

## Consequences

**The coincidence is now written down as a coincidence.** `DEFAULT_WORLD_SETTINGS` holds 3.5 twice,
deliberately, and `worldSettings.test.ts` asserts both values against today's world. If a retune
moves one of them, the other stays where it is and nothing has to be remembered for that to happen.

**Independence is a test, not a comment.** `worldSettings.test.ts` asserts that changing
`oreEdgeBias` leaves the nest layout `toEqual` what it was, and that changing `nestEdgeBias` leaves
the ore grid `toEqual` what it was. The two generators consume separate rngs from separate seeds
(ADR 0004), which is what makes that assertion possible to hold at all.

**#129 labels them separately.** "Ore distribution" and "nest distribution", not one "edge bias" —
the lobby is the one place the domain's words are read by players, and a single label would promise
something the world does not do.

## Alternatives rejected

**One `edgeBias` field moving both.** Matches #97's table and #96's constraint as written, and is
one fewer control. Rejected: it contradicts ADR 0004 in a different field, and it silently couples
the payoff gradient to the threat gradient — the one pair a squad would most want to set against
each other.

**One field with a per-side multiplier** (`edgeBias`, `nestBiasScale`). Two numbers again, but
neither of them readable on its own, and a UI for it has to explain the multiplication. Two plain
knobs at 3.5 each say what they do.
