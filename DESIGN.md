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
- **Sporting & watchable.** Short matches and a stopwatch — mostly a better or worse time, with
  a squad wipe as the one real way to lose.

## The arena

- One big box, ~2 minutes to walk end-to-end. No other rooms.
- **Spawn:** dead center, and protected by nothing. Enemies come all the way in, so a squadmate
  respawning arrives into whatever is standing there.
- **Escape door:** a single random spot on the perimeter wall. Found by clearing the edge.
- **Enemy nests are scattered through the outer arena**, denser and tougher the closer you get
  to the wall.

## Core loop

1. Harvest clusters → fill the global banks.
2. Build miners, walls, turrets, mines.
3. Push toward the edge; silence the nests you find on the way.
4. Sweep the perimeter to find the door.
5. Regroup — **everyone** must reach the door to escape.

## Resources

- **Two types: Metal + Energy**, shared by the whole squad — **no wiring.**
- **Metal is a bank** you stockpile and spend. **Energy is not** — it is a live rate: generators
  raise a ceiling and running turrets draw against it.
- **Ore is tiles, not nodes.** A patch is a cluster of adjacent ore tiles on a 15-unit grid:
  *metal ore* (common) and *power ore* (sparser). Both are infinite — a held patch pays forever.
- **Energy income gates turrets** — hold enough power ore to run them. Metal builds structures.

## Building — miners & defense

- **Build & defend miners:** drop a miner on metal ore; it trickles Metal into the bank.
  Enemies target miners, so wall/turret them. This is the core factory tension.
- Buildables: **miner, generator, wall, turret** — tile-snapped, instant, spent from the bank.
  All four are solid, all four have HP, and demolishing refunds 20%. There is no repair.
- **Hand-mining bootstraps the loop:** hold left-click on metal ore, with the gun stowed, to fund
  your first miner. A buildable taken off the bar outranks it and makes left-click a placement.

## Enemies & bases

- **Nests = spawners.** Fifty of them, placed at random and biased toward the wall. Destroying one
  drops the pressure around it; clearing them all is not expected. A nest is a hunter nest or a
  wanderer nest, the far ones mostly wanderers, and the two look identical — you learn which it is
  from what comes out of it.
- **Timed escalating waves.** Nothing for the first minute, then **each nest on its own timer** —
  no global clock, so fifty nests are fifty drumbeats. The waves come faster, bigger and with more
  elites in them the longer the match runs. Watchable tension.
- **Two things an enemy does when nobody has its attention.** A hunter wave is aimed at a player the
  moment it spawns and comes for them from any distance. Anything else **wanders** — an undirected
  walk with no leash to its nest, which is why the far arena fills up with drifting spiders and the
  middle only slowly does. Either one turns on you the moment you are close enough.
- **A chase leads you.** An enemy steers at where you are going rather than where you are — half the
  current gap ahead, along the way you are running — so it cuts the corner instead of trailing you.
  The further back it is the harder it cuts, and the lead shrinks to nothing as it closes.
- **Roster:** mostly a single grunt type in numbers, with the occasional **elite**. Readable, easy to expand later.

## Weapons & combat

- **One attack: shoot** (left click, gun equipped). The bullet **travels** and the server flies it,
  so a shot can miss — a target crossing your line at the far end of your reach outruns it. Melee was
  tried and cut — a single weapon keeps the fight readable.
- **`g` equips and stows the gun**, and that is what left-click means: the trigger with it up, the
  pick with it down, and never both. You spawn with it stowed. Right-click cancels a selected
  buildable, or demolishes what is under the cursor.
- Turrets shoot the nearest enemy through walls, so a forward line can siege a nest unattended. They
  fire the same travelling bullet and never lead it, so a turret misses where the squad rarely does.
- *(A wider weapon roster stays open — see the TODO below.)*

## Win / lose & the clock

- **Stopwatch — score = escape time.** No hard time limit. The score is **shown at the end
  of the run and not recorded anywhere** — there is no leaderboard and no persistence, so a
  run on custom world settings is scored exactly like any other.
- **Respawn on a timer at center.** Dying = the long walk back = a real time penalty.
- **Escape requires the whole squad at the door** — every connected, living player standing in
  it at the same moment. Forces a final regroup; no one left behind.
- **A simultaneous squad wipe ends the match in a loss.** It is the only hard fail, and it is
  what punishes turtling.

## Scope & tech

- **Platform:** browser — React on an HTML5 canvas, built and tested with Bun. Medium scope.
- **Netcode: client-owned players over a server relay.** Each client integrates its own avatar
  (zero input lag) and interpolates peers a short delay behind; the server owns the shared world
  — enemies, nests, structures, the banks — and streams it as deltas on a 20 Hz tick.

## Open questions / TODO

- Whether the roster ever grows past one weapon, and what a second one would be for.
- Economy tuning: build costs, miner and generator rates, structure HP, ore-patch density.
- Whether infinite ore needs teeth — nothing currently forces a squad to relocate outward.
- Art direction for the sprites, and how much combat feedback the fight needs to read well.
