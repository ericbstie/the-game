# Breakout Box — Design Doc

*Working title. Co-op arena survival for the browser.*

## One-liner

2–6 friends spawn in the center of one giant box. The escape door is hidden
somewhere on the perimeter wall, ringed by enemy nests. Gather, build, and
blast your way to the edge, find the door, and get the whole squad out — fast.
Score is your escape time.

## Pillars

- **Push outward.** Safety is the center; loot, the door, and danger are the edge.
- **Emergent squad play.** Split to sweep faster (risky) or push as a pack (safe) — the map supports both.
- **Sporting & watchable.** Short matches, a stopwatch, no hard fail — just a better or worse time.

## The arena

- One big box, ~2 minutes to walk end-to-end (31,200×31,200 units at 260 u/s — INV-2). No other rooms.
- **Spawn:** dead center, relatively safe.
- **Escape door:** a single random spot on the perimeter wall. Found by clearing the edge.
- **Enemy nests ring the edges**, denser and tougher the closer you get to the wall.

## Core loop

1. Harvest clusters → fill the global banks.
2. Build miners, walls, turrets, mines.
3. Push toward the edge; silence nests along an arc.
4. Sweep the perimeter to find the door.
5. Regroup — **everyone** must reach the door to escape.

## Resources

- **Two types: Metal + Energy.** Both flow into a **global bank — no wiring.**
- **Clusters:** *scrap clusters* and *energy clusters*. Very clustered and rich toward the
  dangerous edge; sparse in the safe center.
- **Energy income gates turrets** — you must build/hold enough energy clusters to run them.
  Metal builds structures.

## Building — miners & defense

- **Build & defend miners:** drop a miner on a cluster; it trickles resources into the bank.
  Enemies target miners, so wall/turret them. This is the core factory tension.
- Buildables: **auto-miner, wall, turret, mine.** Instant placement, spend from the bank.

## Enemies & bases

- **Nests = spawners.** Destroy a nest to silence that arc — clearing carves safe lanes to the edge.
- **Timed escalating waves.** Every ~30s all active nests send a bigger, mixed group — a
  predictable drumbeat the squad preps for. Watchable tension.
- **Roster:** mostly a single grunt type in numbers, with the occasional **elite**. Readable, easy to expand later.

## Weapons & combat

- Both **melee and ranged** matter. Different weapons grant different bonuses:
  - **Melee / tank** weapons → survivability + close-range power.
  - **Range / damage** weapons → reach + DPS.
- Squad naturally diversifies loadouts to cover both. *(Full roster: TODO.)*

## Win / lose & the clock

- **Stopwatch — score = escape time.** No hard time limit; leaderboard by fastest run.
- **Respawn on a timer at center.** Dying = the long walk back = a natural time penalty. No wipes, no rage.
- **Escape requires the whole squad at the door.** Forces a final regroup — no one left behind.

## Scope & tech

- **Platform:** browser — React on an HTML5 canvas, built and tested with Bun. Medium scope.
- **Build order:** local/hotseat prototype first → online netcode (server-relay, client-owned player, 2–6 players) after.

## Netcode

*Server-relay, client-owned player — decided during the M2 refinement (INV-1, #24).*

- **Each client simulates its own avatar** every frame from immediate local input — zero felt
  input lag — and holds the full world (arena, peers, monsters, exit) locally.
- **The server is a relay, not a simulator:** it fans out peer positions (~20 Hz per client),
  owns the one-time **world-init** (arena size, exit placement, monster set, spawns) so all
  clients share identical state, and is the source of truth handed to a reconnecter.
- **Remote peers are interpolated** — buffered and rendered ~100 ms behind real time so they
  glide despite the low update rate (INV-3, #26); your own avatar is instant.
- M1 identity/reconnect is unchanged: avatars keyed by the stable `PlayerId`, 45 s grace,
  takeover-on-duplicate-token, host reassignment.

## Open questions / TODO

- Full weapon & tool roster and exact bonus numbers.
- Elite enemy types and wave composition curve.
- Cluster density and economy tuning. *(Arena size decided: 31,200×31,200 units ≈ 2 min edge-to-edge at 260 u/s — INV-2, #25.)*
