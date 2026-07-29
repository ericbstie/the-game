# ADR 0004 — The nest layout is derived from a seed, not streamed

- **Status:** Accepted
- **Date:** 2026-07-29
- **Applies to:** `nestLayout`, `WorldInit`, and anything that later wants a per-nest property
- **Decides:** the open question stated in
  [#111](https://github.com/ericbstie/the-game/issues/111) and left open on purpose in
  [#123](https://github.com/ericbstie/the-game/issues/123)

## Context

Until #123 the nest layout was a **pure function of the arena**: eight nests, one per 45° sector, the
ray at k·45° projected onto the mid-band square. The comment on it said what that bought —

> so the client derives the same layout without it ever riding the wire

#123 asks for **fifty nests placed at random**, biased outward, each one typed hunter or wanderer and
each one's HP scaled by how far out it sits. Random placement ends "pure function of the arena". The
layout now has entropy in it, and both sides still have to agree on it exactly: the server writes nest
HP and the client draws the health bar against it, the server picks what a nest sends and the client
draws where it stands.

#111 named the two ways out and deliberately chose neither:

1. **Derive from a seed**, the way ore already does — `WorldInit.oreSeed` is one number that both
   sides expand into a byte-identical ~7k-tile grid.
2. **Stream the positions**, and accept that fifty nests is ~6× today's nest data on the wire.

## Decision

**Derive.** `WorldInit` carries a `nestSeed` beside its `oreSeed`, and both sides call
`nestLayout(arena, seed)`, which expands it with the `mulberry32` both already share.

### What decided it — measured, not preferred

| | on `game/world-init`, per connection |
|---|---:|
| derived: `nestSeed` alone | **+22 B** |
| streamed: 50 × `{id, pos, hp}` | **+2,449 B** |

Streaming is **111× the seed**, and it is not a one-off: `game/world-init` is re-sent on every
reconnect, so a squad with a flaky connection pays it again every time.

`bun run delta:size` says the per-tick delta is untouched by the choice either way — 5,045 B → 5,066 B
raw across the whole of #123, which is digit counts. That is expected: nest positions are static, so
they were never in `map-delta` and could not have been. **The whole of the derive-or-stream cost lands
on the keyframes, not on the stream** — which is the thing #111's "~6× today's nest data" framing
did not make obvious, and the reason the numbers above are world-init numbers.

`game/map-delta` is already the fattest thing on the wire (#84). Nothing here makes it fatter, and the
deflate regression #123 did cause (1,704 → 2,008 B/tick) is caused by *where the enemies now are*,
not by anything added to a message — see [the budget](../map-delta-budget.md).

### Two seeds, not one

`nestSeed` is its own number rather than a reuse of `oreSeed`. They are independent worlds, and a
retune of ore generation must not silently move all fifty nests.

It is drawn **after** `oreSeed` in `generateWorld`, so adding it left the exit placement and the ore
grid of any given rng byte-for-byte where they were.

## Consequences

**Agreement is a test, not a hope.** Both sides run the same function on the same seed, so
`clientWorld.test.ts` asserts the client's layout equals the server's *exactly* — positions, ids and
per-nest HP, compared with `toEqual` and not to a tolerance. There is no rounding to reconcile because
there is no transmission.

**A new per-nest property is free.** Hunter-vs-wanderer is the first one, and it costs the wire
nothing. This matters more than the bytes: #123 requires that the two types **look identical**, and a
derived layout is what lets `RenderedNest` carry no kind at all. Nothing the render layer receives
could give the type away, so "you learn a nest's type from what comes out of it" is structural rather
than a rule someone has to remember. Streaming the layout would have put the kind one JSON field away
from the renderer.

**`mulberry32` is load-bearing across two modules now.** It was already the contract that made the ore
grids byte-identical; it is now the contract that makes the nests agree too. Its `Math.imul` and
`>>> 0` coercions are what keep Bun and the browser from drifting apart, and that comment in
`build.ts` should be read as protecting two features, not one.

**`NestSnapshot.pos` is now dead weight on the reconnect keyframe.** The client derives every nest's
position and ignores the streamed one — it reads only `hp` and `alive`. At fifty nests that redundancy
is **2,642 B** of the keyframe (4,383 B → 1,741 B without it). Deliberately left in place here: it is a
wire change #123 did not ask for, and it belongs with #84's other trims. Named so it is not forgotten.

**A nest's type never crosses the wire, so nothing can correct it.** If the two sides ever disagreed
about a layout they would disagree silently — there is no field to compare. That is the same bet the
ore grid has been making since M4, and it is why the seed is drawn from a well-known PRNG rather than
anything platform-provided.

## Alternatives rejected

**Stream the layout on `game/world-init`.** 2,449 B per connection, repeated on every reconnect, to
buy a property the seed already gives — plus it puts the hunter/wanderer type within reach of the
render layer, which #123 explicitly does not want.

**Reuse `oreSeed` for both.** One fewer number on the wire, and it welds ore retuning to nest
placement. Not worth 22 B.

**Keep the layout a pure function of the arena and fake randomness from the index.** A hash of `k`
would keep `nestLayout(arena)` single-argument, and every match would have the identical fifty nests
forever. The ask is a map the squad has to learn each run.
