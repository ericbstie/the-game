# The map-delta budget

What the game costs a player's connection, and what it costs today. First measured in
[#84](https://github.com/ericbstie/the-game/issues/84); re-measurable at any time with
`bun run delta:size`.

`game/map-delta` is the only message that rides continuously — 20 times a second, to every client,
for the whole match. Everything else on the wire is an event or a keyframe. So this one shape is
the game's bandwidth.

## The number

**At the caps the game supports, one client receives 1,704 B/tick — 33.3 KiB/s. Before
[#84](https://github.com/ericbstie/the-game/issues/84) it was 11,369 B/tick, 222.1 KiB/s.**

The worst case is not hypothetical: 240 enemies (`ENEMY_CAP`, the hard governor), a full squad of 6,
30 turrets, and every player firing on the measured tick so `shots` is at its per-tick maximum. It
is produced by driving a real `stepEnemies` sim to the cap and assembling the delta exactly as
`LobbyHub.tick` assembles it, not by a hand-written fixture.

| | per tick | per client |
|---|---:|---:|
| float64 coordinates, uncompressed | 11,369 B | 222.1 KiB/s |
| trimmed coordinates, uncompressed | 5,045 B | 98.5 KiB/s |
| float64 coordinates, deflate | 4,919 B | 96.1 KiB/s |
| **trimmed coordinates, deflate — what ships** | **1,704 B** | **33.3 KiB/s** |

Trimming alone takes **55.6%** off. Deflate takes **66.2%** off what remains. Together they are
**85.0%** against the old wire.

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

- **66.2% smaller**, even after the trim — the payload is repetitive JSON, with ids and key names
  recurring 240 times a tick.
- **0.07 ms per tick per client**, which is **0.8% of one core** for a full squad of 6.

Trimming and compressing are not alternatives. Trimming also makes the stream *more* compressible:
the trimmed delta deflates to 1,704 B where the float64 one deflates to 4,919 B, so the trim is
still worth 65% after the compressor has had its turn.

## Re-measuring

```sh
bun run delta:size          # the table above
bun run delta:size --json   # the same figures, for a diff
```

The deflate figure uses `Bun.deflateSync`, which emits a zlib wrapper; permessage-deflate on the
wire uses raw deflate and will run a handful of bytes smaller per frame. The direction of that
error is conservative, which is the honest way to be wrong about a budget.
