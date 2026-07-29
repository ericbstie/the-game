# The map-delta budget

What the game costs a player's connection, and what it costs today. First measured in
[#84](https://github.com/ericbstie/the-game/issues/84); re-measurable at any time with
`bun run delta:size`.

`game/map-delta` is the only message that rides continuously — 20 times a second, to every client,
for the whole match. Everything else on the wire is an event or a keyframe. So this one shape is
the game's bandwidth.

## The number

**At the caps the game supports, one client receives 1,985 B/tick — 38.8 KiB/s. Before
[#84](https://github.com/ericbstie/the-game/issues/84) it was 11,369 B/tick, 222.1 KiB/s.**

The worst case is not hypothetical: 240 enemies (`ENEMY_CAP`, the hard governor), a full squad of 6,
30 turrets, and every player firing on the measured tick so `shots` is at its per-tick maximum. It
is produced by driving a real `stepEnemies` sim to the cap and assembling the delta exactly as
`LobbyHub.tick` assembles it, not by a hand-written fixture.

| | per tick | per client |
|---|---:|---:|
| float64 coordinates, uncompressed | 10,941 B | 213.7 KiB/s |
| trimmed coordinates, uncompressed | 5,216 B | 101.9 KiB/s |
| float64 coordinates, deflate | 4,874 B | 95.2 KiB/s |
| **trimmed coordinates, deflate — what ships** | **1,985 B** | **38.8 KiB/s** |

Trimming alone takes **52.3%** off. Deflate takes **61.9%** off what remains. Together they are
**81.9%** against the old wire.

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

- **60.4% smaller**, even after the trim — the payload is repetitive JSON, with ids and key names
  recurring 240 times a tick.
- **0.10 ms per tick per client**, which is **1.2% of one core** for a full squad of 6.

Trimming and compressing are not alternatives. Trimming also makes the stream *more* compressible:
the trimmed delta deflates to 1,985 B where the float64 one deflates to 4,874 B, so the trim is
still worth 59% after the compressor has had its turn.

## Re-measuring

```sh
bun run delta:size          # the table above
bun run delta:size --json   # the same figures, for a diff
```

The deflate figure uses `Bun.deflateSync`, which emits a zlib wrapper; permessage-deflate on the
wire uses raw deflate and will run a handful of bytes smaller per frame. The direction of that
error is conservative, which is the honest way to be wrong about a budget.
