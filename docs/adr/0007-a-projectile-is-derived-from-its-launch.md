# ADR 0007 — A projectile is derived from its launch, and every one drawn came from the server

- **Status:** Accepted
- **Date:** 2026-08-02
- **Applies to:** every shot the game fires, from [#80](https://github.com/ericbstie/the-game/issues/80) onward
- **Decides:** the turret wire question [#80](https://github.com/ericbstie/the-game/issues/80) reopened —
  [#74](https://github.com/ericbstie/the-game/issues/74) §5 chose held-line transitions over
  per-shot streaming, and a travelling shot is per-shot state by nature
- **Amends:** [ADR 0003](0003-what-a-rendered-shot-guarantees.md), whose §2 kept own shots
  un-round-tripped and whose invariant was therefore true for two of three shot sources

## Context

Until #80 a shot was a hitscan ray: the sim resolved it the tick the hub admitted it, and the
drawing was a line that lived 100 ms. #80 asks for a shot that **travels**, that the **server**
flies, and that can **miss** — for turret fire as much as for the squad's.

Three things fall out, and none of them is settled by the ask:

1. **What carries a shot to the client.** A hitscan line was one small event. A flight is a
   position that changes twenty times a second, for eight ticks, for every shot in the air —
   on `game/map-delta`, already the fattest thing on the wire ([#84](https://github.com/ericbstie/the-game/issues/84)).
2. **Whether a turret's fire stays off the wire.** #74 measured per-shot turret streaming at 2.3%
   of a delta against 0.9% for `(target, powered)` transitions and chose transitions. A projectile
   is per-shot by nature, so that trade has to be taken again rather than bent around.
3. **Where the client's own shot comes from.** ADR 0003 §2 kept own shots un-round-tripped so the
   line appeared on the click. A projectile that the client flies itself cannot know where to stop.

## Decision

### 1. The wire carries a launch and an end. The flight between them is derived.

`MapDelta` gains two fields and loses `shots`:

```ts
export type ProjectileSpawn = [id: string, x: number, y: number, dx: number, dy: number];

  projectiles?: ProjectileSpawn[];  // put in the air this tick
  spent?: string[];                 // taken out of it this tick
```

A shot is a straight line at `PROJECTILE_SPEED`, a constant both sides compile against, so where it
has got to is arithmetic on the launch. Streaming that position every tick would be re-sending a
number the receiver can already work out — the same derive-don't-stream bet the ore grid has made
since M4 and the nest layout since [ADR 0004](0004-nest-layout-is-derived-from-a-seed.md).

`spent` is what the client cannot derive, and it is the whole of it: whether a bullet reached
something is an authoritative rule resolved against live enemy positions, and re-running it
client-side against sprites `ENEMY_RENDER_DELAY_MS` behind is exactly what ADR 0003 §3 forbids.

**Turret fire therefore rides the wire per shot, and #74's decision is reversed for the shots.**
The `(target, powered)` transition stays exactly as #74 shaped it, because it is still what draws
the **unpowered lightning** — but it no longer draws the fire, and the client no longer generates a
pulse train.

### 2. What decided it — measured, not preferred

`bun run delta:size` builds both shapes from **one tick** of a real sim at `ENEMY_CAP` 500, six
players all firing, thirty turrets engaged, taken after thirty ticks of warm-up so the sky is
already full rather than empty.

| on `game/map-delta`, per tick | raw | deflate |
|---|---:|---:|
| the whole tick, no shot on it at all | 10,151 B | 3,767 B |
| **derived — a launch and a `spent`, what ships** | **10,359 B** | **3,834 B** |
| streamed — a position each, at the 9 in the air | 10,331 B | 3,819 B |
| streamed, at the 68 the cadences allow | 11,511 B | — |

**At the density the game actually reaches, the two are the same size — and that is not the
finding.** Nine shots were in the air on the measured tick, because at `ENEMY_CAP` almost every
shot meets something on its first tick; streaming nine positions is 20 B each and costs less than
thirteen launches at ~40 B. The finding is what the two are *charged by*:

> **Deriving is charged per shot fired. Streaming is charged per shot in the air.**

The first is bounded by cadences the game already fixes — `RANGED_CADENCE_MS` and
`TURRET_CADENCE_MS` — and cannot move without a balance change. The second is bounded by
`PROJECTILE_RANGE / PROJECTILE_SPEED`, and **`PROJECTILE_SPEED` is provisional**: halving it
doubles the streamed cost and leaves the derived cost exactly where it was. A budget that a retune
can double is not a budget.

The ceiling row is the other half. 6 players at 4 shots/s and 30 turrets at 5 shots/s is 174
launches a second; a shot lives 389 ms; so **68 in the air is the most the cadences can produce**,
and only if every one of them misses. Streaming there is +1,152 B/tick — **11.1%** on a message the
game has spent two tickets trimming. Deriving is unchanged at 68 as it is at 9.

**What the derived fields cost is 208 B/tick raw, 67 B deflate** — 1.7% of the payload, against the
same tick with no shot on it at all. `docs/map-delta-budget.md` carries the figures.

### 3. Every projectile the client draws came from the server, including your own

ADR 0003 §2 said own shots stay un-round-tripped, and this reopens it. **They now round-trip like
everybody else's, and `ShotSource`, `OwnShot` and the turret pulse train are gone.**

What made round-tripping unacceptable is not the trade on the table any more. A hitscan line's whole
existence was the instant it was fired, so a tick of delay delayed 100% of the event. A flight is
389 ms long; a tick of delay before the bullet leaves the barrel is 13% of it, and the impact — the
thing the player is waiting for — was always going to be a third of a second out.

What it buys is the invariant ADR 0003 could not state:

> **A projectile is drawn because the server has one in the air. There is no other source.**

That is now structural rather than a rule. `ClientWorld.applyMapDelta` is the only writer of the
projectile map; there is no optimistic entry and nothing in the render layer that can make one. The
client's cadence, ammo and death gates still exist — they keep the socket from carrying reports the
hub would throw away — but **none of them stands between a refusal and a drawing**, which is what
[#85](https://github.com/ericbstie/the-game/issues/85) was closed for and what a 389 ms flight would
otherwise have made eight times worse.

The three cases ADR 0003 §5 named as knowable-or-not go with it. The client no longer approximates
any server rule to decide what to draw, so there is nothing left to diverge.

### 4. A shot's origin is the hub's, not the report's

`game/attack` still carries `pos`, and `admitAttack` still refuses a report more than
`ATTACK_POS_TOLERANCE` (500 u) from the stream. But the projectile now **launches from
`session.positions`** — the same sample every other client is relayed and the sim already chases.

Under hitscan a forged origin only slid the ray. Against a travelling shot, 500 u along the aim is
**278 ms off the flight** — a shot nothing in the arena could outrun — and it would have been
admitted. The reported `pos` is now an admission input and never a coordinate anything is computed
from. A player the hub has no position for cannot shoot at all.

The client is trusted for a **heading**, and for nothing else about a shot. Speed, reach, flight
time, what it strikes and when the damage lands are all this server's arithmetic against positions
it owns.

## Consequences

**The frame got cheaper, which nobody expected.** A hitscan line lived 100 ms, so the budget carried
50 concurrent marks of ~14 strokes each in 50 paths. A flight lives 389 ms, so the frame carries
**20** — the same derived-from-the-cadences arithmetic, `concurrentShots()` in
`scripts/shot-ink.ts` — each **one** stroke, all in **one** path. `bun run frame:budget` reports
**14 stroked paths** where it reported 63, and the shot layer at 0.26 ms.
`docs/frame-budget.md` carries the ladder.

**A turret is the shooter that misses.** Measured against a live sim — one shot in the air at a
time, so each `spent` is unambiguous, over eight virtual minutes at mid-match density:

| shooter | connects |
|---|---:|
| a player, aiming at the body of whatever is nearest | 871/876 — **99.4%** |
| the same player, leading the target | 1041/1048 — 99.3% |
| a player standing still, covering a kiting teammate | 841/851 — 98.8% |
| a turret, which never leads | 130/164 — **79.3%** |

**A player barely misses, and the reason is the AI rather than the aim.** Enemies chase *you*, so
your target is closing along the line you are shooting down, and nothing in the arena can outrun a
shot it is running towards. Leading buys nothing measurable. A turret shoots whatever is *nearest*,
which is usually chasing a player somewhere else and therefore crossing — and a crossing elite at
maximum range is missed by 94 u against a 48 u tolerance.

The turret figure is 164 samples and should be read as "about four in five" rather than as 79.3.

**Speed is the dial, and 1,800 u/s is on the shoulder of the curve.** The same probe at four speeds:

| `PROJECTILE_SPEED` | player | turret |
|---:|---:|---:|
| 900 | 96.5% | 83.2% |
| 1,200 | 98.0% | 78.3% |
| **1,800 — what ships** | **99.4%** | **79.3%** |
| 2,700 | 99.5% | 84.5% |

The player curve is clean and flattens above 1,800; the turret figures are inside their own noise at
this sample size. **1,800 is provisional** — a later value is a retune — and the arithmetic behind
the pick is not: a target crossing the line escapes once it clears `RANGED_HALFWIDTH` plus its own
radius before the shot arrives, which for an elite is 48 u at a range of
`48 × PROJECTILE_SPEED / ELITE_SPEED` — **369 u at 1,800**. So the near half of the weapon's 700 u
reach is point-and-click and the far half has to be led.

**The four balance numbers were re-judged and none of them moved.**

- `RANGED_DAMAGE` **3** — at a 99% hit rate ten connects still cost about ten bullets (50.5 Metal
  against 50), so there is nothing to compensate. It is also load-bearing: `BLOODLING_HP` is
  documented as "five shots at `RANGED_DAMAGE` where a grunt takes ten".
- `RANGED_CADENCE_MS` **250** — the ticket calls this "the 0.5 s auto-fire cadence (#103)"; #119
  halved it and 250 is what ships. A faster trigger has nothing to make up at 99% and would only
  spend the squad's Metal quicker.
- `TURRET_DAMAGE` **4** / `TURRET_CADENCE_MS` **200** — the *claim* moved and the numbers did not.
  "~20 dps kills a 30 HP grunt in ~1.5 s" is now **~16 dps and ~1.9 s**, and `src/game/build.ts`
  says so. Missing is the whole of what #80 adds and the turret is the only place it bites; buying
  it back in the damage would leave the game where it was with a flight simulation bolted on.

**A turret miss wastes Metal, and #80's text says it does not.** The ticket reads "Turrets spend
energy, not ammo — a turret miss wastes time, not Metal", which was true when it was written and
stopped being true at [#102](https://github.com/ericbstie/the-game/issues/102): `stepTurrets` calls
`spendBullet` on the squad's shared pool, and ADR 0003's own amendment records it. So a fifth of
every engaged turret's fire is 5 Metal on the floor — at thirty turrets, **150 Metal a second**.
That is the largest economic consequence of this ticket and it is **not** retuned here, because
`BULLET_COST` is not among the numbers #80 put in scope. Named so it is not discovered.

**A reconnecting client sees no shot that was already in the air.** `game/enemy-init` carries no
projectiles, deliberately: a flight is 389 ms and a reconnect is not, so the keyframe would be
carrying something that had landed before it arrived. The `hits` those shots cause still stream, so
a reconnecter may see a burst with no bullet behind it, for at most one flight.

**The sweep is widened by one enemy step, and that is not slack for its own sake.** A shot crosses
90 u in a tick and a grunt is 32 u across, so the hit test is against the segment swept rather than
the point landed on. Bodies move between ticks too: a grunt closing head-on shortens the gap by its
own step *as well as* by the shot's, so one sitting a few units past this tick's far end could be
*behind* the near end of the next tick's without either sweep containing it. At `FASTEST_ENEMY` that
seam swallowed about a tenth of every head-on shot. The far end is extended by exactly one step of
the fastest thing that could be closing, which makes the seam provably empty rather than narrow.

## Alternatives rejected

**Stream every projectile's position per tick.** Measured above. Same size today, 11.1% at the
ceiling the cadences allow, and its cost rides a provisional constant. It also puts a bullet in
`moves`, where the client's unknown-id guard and the enemy render path would both have to learn
that some ids are not bodies.

**Keep own shots local and optimistic.** The client would have to fly its own bullet and could not
know where to stop it — so it would pass straight through the spider the server damaged, which is a
depiction of a *miss the server did not make*. A hitscan line to full range "implies only a
direction" (ADR 0003 §3); a bullet passing through a body implies it went past.

**Send the impact point on `spent`.** Two more numbers per shot to save the client an arithmetic
step it can already take from the launch and the arrival tick. The residual error is under half a
tick of travel, on a mark that is 52 u long.

**Give turrets a lead.** Nothing asked for one, and it would make a turret a better shot than the
squad — the one shooter #80's miss is real for would stop missing.

**Line of sight.** A shot passes through walls, exactly as the hitscan ray did. Nothing asked for a
firing lane, and giving one would silently make every walled-in base a turret cage.
