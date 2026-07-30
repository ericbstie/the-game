# The map-delta budget

What the game costs a player's connection, and what it costs today. First measured in
[#84](https://github.com/ericbstie/the-game/issues/84); re-measurable at any time with
`bun run delta:size`.

`game/map-delta` is the only message that rides continuously — 20 times a second, to every client,
for the whole match. Everything else on the wire is an event or a keyframe. So this one shape is
the game's bandwidth.

## The number

**At the caps the game supports, one client receives 3,855 B/tick — 75.3 KiB/s. Before
[#84](https://github.com/ericbstie/the-game/issues/84) it was 11,369 B/tick, 222.1 KiB/s.**

The worst case is not hypothetical: 500 enemies (`WorldSettings.enemyCap`, the hard governor), a
full squad of 6, 30 turrets, and every player firing on the measured tick so `shots` is at its
per-tick maximum. It is produced by driving a real `stepEnemies` sim to the cap and assembling the
delta exactly as `LobbyHub.tick` assembles it, not by a hand-written fixture.

| | per tick | per client |
|---|---:|---:|
| float64 coordinates, uncompressed | 21,363 B | 417.2 KiB/s |
| trimmed coordinates, uncompressed | 10,501 B | 205.1 KiB/s |
| float64 coordinates, deflate | 9,540 B | 186.3 KiB/s |
| **trimmed coordinates, deflate — what ships** | **3,855 B** | **75.3 KiB/s** |

Trimming alone takes **50.8%** off. Deflate takes **63.3%** off what remains. Together they are
**82.0%** against the old wire.

### What #123 moved, and why it is not a leak

Scattering the nests ([#123](https://github.com/ericbstie/the-game/issues/123)) left the raw delta
where it was — 5,045 B before, 5,066 B after, which is digit counts and nothing else — and cost
**304 B/tick after deflate** (1,704 → 2,008, before #124 moved it again below). Nothing was added
to the shape. Nest positions do not
ride the delta and never did; they are derived from `WorldInit.nestSeed`
([ADR 0004](adr/0004-nest-layout-is-derived-from-a-seed.md)).

What changed is **how compressible the same bytes are**. Eight nests on a ring put 240 enemies in
eight tight clusters, and clustered coordinates share leading digits, which is exactly what deflate
eats. Fifty nests spread from 3,600 u to 14,352 u put those enemies all over the arena, so the
`moves` array repeats far less of itself. The compressor's take fell from 66.2% to 60.4% on an
almost identical payload.

It is a real 304 B/tick and it is worth naming, but it is the price of a map that is not eight
clusters — not a field somebody put on the wire.

### What #124 moved, and it took a field off

The per-nest spawn model ([#124](https://github.com/ericbstie/the-game/issues/124)) **removed**
`MapDelta.wave` and `game/enemy-init`'s required `wave` — there is no global wave clock left to
report. That field only ever rode on the tick a wave fired, so it never appeared in the measurement
above; what it is worth is ~36 B (`"wave":{"index":12,"clockMs":29950}`) on each firing tick and on
every reconnect keyframe, now zero.

The measured settled tick moved anyway: **5,066 → 5,216 B raw, 2,008 → 1,985 B deflate.** Same
cause as #123 and the same non-cause — nothing was added or removed from the measured shape. With
hunter waves committing to a player at any distance, the 240 enemies at the cap now stand in around
the squad instead of holding at a 13,104 u edge, so their coordinates carry different digit counts
(the raw rise) and repeat each other more (the deflate fall). **Where the enemies are is what this
budget measures**, which is worth saying twice: two features in a row have moved it without
touching a message.

### What #125 moved, and this one is the cap itself

[#125](https://github.com/ericbstie/the-game/issues/125) raised `ENEMY_CAP` from **240 to 500** and
removed the hold edge, so an un-aggroed enemy now wanders anywhere in the arena instead of parking on
a ring. `game/map-delta` is a per-enemy stream, so this is the first of the three stages whose cost is
in the *count* rather than in the coordinates:

| | at cap 240 | at cap 500 | ratio |
|---|---:|---:|---:|
| trimmed raw | 5,216 B | 10,501 B | ×2.013 |
| **trimmed deflate — what ships** | **1,985 B** | **3,855 B** | **×1.942** |
| deflate CPU, per tick per client | 0.107 ms | 0.223 ms | ×2.08 |

**It is sub-linear in the cap, which is the thing worth knowing.** 500/240 is ×2.083 and the shipped
bytes went up by ×1.942, because deflate's take *improved* — 61.9% → 63.3% — on 2.08× as many `moves`
entries. More enemies means more repetition of `["eNNNN",` and of leading coordinate digits, and that
is what the compressor eats. Undirected wandering scatters the coordinates further than #123's fifty
nests did, and it still did not cost more than the count.

**Nothing was added to the shape.** `src/lobby/protocol.ts` is byte-identical across this stage: no
field for the wander heading, no field for a nest's kind. A wanderer's leg is server-only per-enemy
state, exactly as a hunter's commitment is ([ADR 0004](adr/0004-nest-layout-is-derived-from-a-seed.md)).

### What #128 moved, and it is not this message

[#128](https://github.com/ericbstie/the-game/issues/128) put the world's settings on the wire, and
the measured tick is **unchanged: 10,501 B raw / 3,855 B deflate.** That is not luck and it is not an
assumption — the settings are static, so `game/world-init` is the only shape that could carry them,
and `bun run delta:size` was run on both sides of the change to say so rather than to guess it.

Where the cost landed is the keyframe:

| `game/world-init`, 6 players | raw | deflate |
|---|---:|---:|
| before #128 | 608 B | 256 B |
| after #128 | 906 B | 400 B |
| **the `settings` field** | **+298 B** | **+144 B** |

**It is paid per connection, not per match**, on the same terms as everything else on this message:
world-init is re-sent on every reconnect, so a squad with a flaky connection pays it again each time.
For scale, [ADR 0004](adr/0004-nest-layout-is-derived-from-a-seed.md) measured `nestSeed` at +22 B and
the streamed alternative to it at +2,449 B.

Unlike that one, this is not a choice between two encodings. Both sides expand `oreSeed` and
`nestSeed` themselves, so a client that was not told the settings would build a *different world* —
there is no cheaper encoding of "not sending them". A packed positional encoding of the ten knobs
would be smaller than the keyed object and was not built: nobody asked, and 298 B once per connection
against 3,855 B twenty times a second is not where this game's bandwidth is.

**Is 75.3 KiB/s per client acceptable? Yes, and the comparison that settles it is on this page.** The
game shipped at **222.1 KiB/s** before #84, and #84's own untrimmed float64 tick *at cap 240* was
**95.2 KiB/s**. So the arena at more than twice the population is cheaper per client than the same
arena was before coordinates were trimmed. Server egress for a full squad is 6 × 20 × 3,855 B =
**452 KiB/s**, and the compressor bill for that squad is **2.7% of one core** (up from 1.3%).

## Where it went

**Coordinate precision was ~55% of the baseline.** A single `moves` entry used to serialise as

```json
["e4000",28702.641181218652,15788.706322716223]
```

`enemy.pos` is float64 because the sim integrates in float64, and `JSON.stringify` prints every
digit of it. But **1 world unit = 1 CSS px** at the fixed M4 zoom, so all of that precision is
strictly sub-pixel — and not even sub-pixel *motion*, because the client interpolates between
samples anyway. Rounding on the way out costs nothing anyone can see.

`PeerShot.dir` had the same problem in miniature: a full-precision unit vector, where three
decimals is under half a world unit of lateral drift at `RANGED_RANGE` (700).

Both are **serialisation only**. The sim keeps every bit it had — `stepEnemies` still integrates in
float64, and `nearestRayHit` still resolves against the exact aim vector it was given, not the
rounded one. Rounding the authoritative input would have been a gameplay change wearing a
bandwidth ticket's clothes; there are tests pinning both halves.

## Compression

`perMessageDeflate` is **on**. Bun's default is off, so until #84 nothing on this socket was
compressed.

It is worth it by a wide margin, and the cost side is the half that bytes alone cannot show:

- **63.3% smaller**, even after the trim — the payload is repetitive JSON, with ids and key names
  recurring 500 times a tick.
- **0.22 ms per tick per client**, which is **2.7% of one core** for a full squad of 6.

Trimming and compressing are not alternatives. Trimming also makes the stream *more* compressible:
the trimmed delta deflates to 3,855 B where the float64 one deflates to 9,540 B, so the trim is
still worth 60% after the compressor has had its turn.

## Re-measuring

```sh
bun run delta:size          # the table above
bun run delta:size --json   # the same figures, for a diff
```

The deflate figure uses `Bun.deflateSync`, which emits a zlib wrapper; permessage-deflate on the
wire uses raw deflate and will run a handful of bytes smaller per frame. The direction of that
error is conservative, which is the honest way to be wrong about a budget.
