import type {
  Arena,
  Bank,
  BuildableKind,
  OreKind,
  Power,
  StructureSpawn,
  Tile,
  TurretAim,
  Vec2,
} from "../lobby/protocol";
import { DANGER_BAND_FRAC } from "./world";
import { DEFAULT_WORLD_SETTINGS, type WorldSettings } from "./worldSettings";

// The box world's buildable side (Milestone 4): the tile grid every structure snaps to, the
// ore the arena is seeded with, and the admission rules guarding the shared economy. Pure and
// deterministic — no clock (time is the injected `now`) and no ambient randomness (the only
// entropy is the world's `oreSeed`) — so it unit-tests fully and, crucially, runs identically
// on the server and on every client.
//
// Ore never rides the wire: both sides call `generateOre(arena, oreSeed)` and get a
// byte-identical grid, the same derive-don't-stream idiom `nestLayout` already uses.

export const TILE = 15; // world units per tile; the 31,200² arena is 2,080 × 2,080 tiles

// Tiles are packed into one number so the render loop can probe the grid without allocating a
// string key per lookup. Valid because tiles are non-negative and the arena is far under 65,536
// tiles a side.
const KEY_STRIDE = 1 << 16;

// The widest arena that assumption holds for. A host sizes the arena now (#127), and this is what
// stops being true first: past `KEY_STRIDE` tiles a side, two different tiles pack to one key and the
// ore grid is degenerate. *Identically* degenerate on both sides, so it desyncs nobody — which is why
// ADR 0006 records it here as a limit rather than enforcing it in the settings parser. It lives beside
// the stride it is a fact about, so #129's control can offer up to it without a second copy of `TILE`.
export const MAX_ARENA_SIDE = KEY_STRIDE * TILE;

export type OreGrid = Map<number, OreKind>;

export function tileKey(tile: Tile): number {
  return tile.tx * KEY_STRIDE + tile.ty;
}

// The tile a packed key came from. Lookups never need this — the grid is asked about a tile it
// already has — but aggregating the grid does, and the unpacking belongs beside the packing rather
// than wherever the stride is next needed (#93).
export function tileFromKey(key: number): Tile {
  return { tx: Math.floor(key / KEY_STRIDE), ty: key % KEY_STRIDE };
}

export function tileOf(pos: Vec2): Tile {
  return { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) };
}

// The world position of a tile's top-left corner.
export function tileOrigin(tile: Tile): Vec2 {
  return { x: tile.tx * TILE, y: tile.ty * TILE };
}

export function tileCenter(tile: Tile): Vec2 {
  return { x: tile.tx * TILE + TILE / 2, y: tile.ty * TILE + TILE / 2 };
}

export function oreAt(grid: OreGrid, tile: Tile): OreKind | null {
  if (tile.tx < 0 || tile.ty < 0) return null; // off-grid; the packed key would alias
  return grid.get(tileKey(tile)) ?? null;
}

// The tiles a straight move from `from` to `to` crosses, in order, excluding `from` and including
// `to`. A drag places across every tile the cursor crosses (#104), and a pointer read once a frame
// leaps several tiles between reads — so the path between two samples is what gets placed, not the
// pair of endpoints. A sample that has not left its tile yields nothing, which is what keeps the
// tile a drag started on from being placed a second time on its first move.
//
// Bresenham, stepping one axis per iteration rather than both: the resulting staircase is
// 4-connected, so a diagonal drag lays a wall with no corner an enemy could walk diagonally
// through. The true 8-connected line is shorter and would leave exactly those holes.
export function tilesBetween(from: Tile, to: Tile): Tile[] {
  const path: Tile[] = [];
  let { tx, ty } = from;
  const dx = Math.abs(to.tx - tx);
  const dy = Math.abs(to.ty - ty);
  const sx = Math.sign(to.tx - tx);
  const sy = Math.sign(to.ty - ty);
  let err = dx - dy;
  while (tx !== to.tx || ty !== to.ty) {
    if (2 * err > -dy) {
      err -= dy;
      tx += sx;
    } else {
      err += dx;
      ty += sy;
    }
    path.push({ tx, ty });
  }
  return path;
}

// --- Ore generation ---------------------------------------------------------------------
// Patches are blobs grown by accretion from a seed tile, scattered with a real center→edge
// gradient: DESIGN.md puts the riches at the dangerous wall, so pushing outward pays. A handful
// of patches are reserved for the center so a squad that has just spawned can always bootstrap.

// How many patches of each ore, and how far out they sit, are knobs — `WorldSettings.metalPatches`,
// `powerPatches` and `oreEdgeBias` (#127). What a patch is *made of* is not: the sizes below shape
// what a patch looks like once placed, and nobody asked for those.
const METAL_PATCH_MIN = 30;
const METAL_PATCH_MAX = 80;
const POWER_PATCH_MIN = 10;
const POWER_PATCH_MAX = 20;

// Patch centers sit at `frac` of the arena half-extent, in the max-norm — the same square
// projection `nestLayout` uses, so ore and nests share one notion of "how far out". They do not
// share how hard they lean on it: that is a knob each (`docs/adr/0005`).
const ORE_MAX_FRAC = 1 - DANGER_BAND_FRAC / 2; // patches reach past the nest ring, short of the wall
const ORE_MIN_FRAC = 0.02;
const BOOTSTRAP_PATCHES = 4; // metal patches pinned near center; the rest follow the gradient
const BOOTSTRAP_MAX_FRAC = 0.06;
// And how many power patches are pinned there too, so a squad that has just spawned can always
// find somewhere to stand a generator. Provisional, like every balance number.
const POWER_BOOTSTRAP_MIN = 1;
const POWER_BOOTSTRAP_MAX = 3;

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Seed the arena's ore. Power patches are placed first so they stay whole — metal is common
// enough that the holes it inherits don't matter, and a tile is only ever one kind.
//
// `arena` stays its own argument rather than being read off `settings`, even though the settings
// now ride `WorldInit` too (#128): the box is the one thing the init states outright, so taking it
// from there keeps a settings mismatch from also becoming a differently-sized grid. Both are the
// same number by construction — `generateWorld` reads the arena it reports off the settings it
// reports — and this way that stays true because of where each is read, not by coincidence.
export function generateOre(
  arena: Arena,
  seed: number,
  settings: WorldSettings = DEFAULT_WORLD_SETTINGS,
): OreGrid {
  const rng = mulberry32(seed);
  const grid: OreGrid = new Map();
  const maxTile = Math.floor(Math.min(arena.width, arena.height) / TILE) - 1;
  const powerBootstrap = size(rng, POWER_BOOTSTRAP_MIN, POWER_BOOTSTRAP_MAX);
  for (let i = 0; i < settings.powerPatches; i++) {
    growPatch(
      grid,
      "power",
      patchSeedTile(arena, rng, i < powerBootstrap, settings.oreEdgeBias),
      size(rng, POWER_PATCH_MIN, POWER_PATCH_MAX),
      rng,
      maxTile,
    );
  }
  for (let i = 0; i < settings.metalPatches; i++) {
    const bootstrap = i < BOOTSTRAP_PATCHES;
    growPatch(
      grid,
      "metal",
      patchSeedTile(arena, rng, bootstrap, settings.oreEdgeBias),
      size(rng, METAL_PATCH_MIN, METAL_PATCH_MAX),
      rng,
      maxTile,
    );
  }
  return grid;
}

function size(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Where a patch starts: a bearing plus a radial fraction, projected onto the arena square.
function patchSeedTile(
  arena: Arena,
  rng: () => number,
  bootstrap: boolean,
  edgeBias: number,
): Tile {
  const angle = rng() * Math.PI * 2;
  const frac = bootstrap
    ? ORE_MIN_FRAC + rng() * (BOOTSTRAP_MAX_FRAC - ORE_MIN_FRAC)
    : ORE_MIN_FRAC + rng() ** (1 / edgeBias) * (ORE_MAX_FRAC - ORE_MIN_FRAC);
  const half = Math.min(arena.width, arena.height) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const reach = (frac * half) / Math.max(Math.abs(cos), Math.abs(sin)); // project onto the square
  return tileOf({ x: arena.width / 2 + reach * cos, y: arena.height / 2 + reach * sin });
}

// Grow one blob by accretion: repeatedly pick a tile already in the patch and claim a free
// neighbour. `attempts` bounds the walk so a patch boxed in by an earlier one still terminates.
function growPatch(
  grid: OreGrid,
  kind: OreKind,
  origin: Tile,
  target: number,
  rng: () => number,
  maxTile: number,
): void {
  const inPatch: Tile[] = [];
  const claim = (tile: Tile): boolean => {
    if (tile.tx < 0 || tile.ty < 0 || tile.tx > maxTile || tile.ty > maxTile) return false;
    const key = tileKey(tile);
    if (grid.has(key)) return false;
    grid.set(key, kind);
    inPatch.push(tile);
    return true;
  };
  if (!claim(origin)) return;
  let attempts = target * 8;
  while (inPatch.length < target && attempts-- > 0) {
    const from = inPatch[Math.floor(rng() * inPatch.length)];
    const [dx, dy] = NEIGHBORS[Math.floor(rng() * NEIGHBORS.length)];
    claim({ tx: from.tx + dx, ty: from.ty + dy });
  }
}

// Mulberry32: the smallest well-known 32-bit PRNG that runs identically on the Bun server and in
// the browser. `Math.imul` and the `>>> 0` coercions are what keep the two byte-identical —
// without them the multiply would drift into float precision and the grids would diverge.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// --- Hand-mining ------------------------------------------------------------------------
// Holding left-click on a metal-ore tile, with the gun stowed (#120), mines it straight into the
// shared bank. Power ore has no hand-mine path at all: Energy is a live rate with nowhere to store
// what you'd dig up.
//
// A report is one *harvested* tile, not a tick of holding (#130): the client takes the tile's
// harvest progress to zero — client-local, at HAND_MINE_RATE, `harvest.ts` — and asks once, for
// the one whole Metal it just earned.

export const HAND_MINE_RATE = 2; // metal per second held

// How far short of a whole harvest two honest reports may land, and the only reason the floor below
// is not the harvest's full length. A client spends its progress from render-frame deltas and
// reports on the frame one completes, so a repeat leaves a frame *after* its deadline rather than
// before it — but the server times arrivals, and a quicker second trip closes that gap again. One
// frame at 60 Hz is what a report's departure is quantised to, so it is what a pair's arrival is
// allowed to be short by. Everything wider is Metal that was never dug.
export const MINE_JITTER_MS = 1_000 / 60;

// Server-side floor on how often a client may report mining, and the whole bound on a forged one's
// income. It is the harvest being claimed, less that jitter: one report is one tile taken to zero,
// which takes 1_000 / HAND_MINE_RATE ms of holding — ORE_HARVEST_MS in `harvest.ts`, derived there
// from this same rate and not imported here, because what both sides run must not depend on the
// client-local module that depends on it. A floor looser than the harvest is a multiplier on a
// liar's income and nothing else: at 100 ms a motionless forgery earned ten Metal a second against
// an honest hand's one.
export const MINE_CADENCE_MS = 1_000 / HAND_MINE_RATE - MINE_JITTER_MS;
// The one loose reach shared by mining, building and demolishing. "Whatever is on screen" is
// unknowable server-side, so — like ATTACK_POS_TOLERANCE — this is an anti-teleport bound, not
// an exact reach.
export const INTERACT_REACH = 2_000;

// Per-player hand-mine admission state. `seq` guards apply-if-newer; `lastAt` is the cadence floor.
export interface MineGuard {
  seq: number;
  lastAt: number;
}

export function freshMineGuard(): MineGuard {
  return { seq: -1, lastAt: Number.NEGATIVE_INFINITY };
}

// How much Metal a reported hand-mine earns, or 0 if it is not admitted. Mutating `guard` as a
// side effect mirrors `admitAttack`.
//
// One admitted report is one whole Metal, because one report is one tile taken to zero harvest
// progress. That progress is client-local and unverifiable from here, so the yield is what the
// client is trusted on — deliberately, and the only such figure in the game. What is still checked
// is everything the server *can* see: the ore under the tile, the reporter's distance from it, the
// sequence, and the cadence floor that bounds how fast a liar could repeat.
export function admitMine(
  guard: MineGuard,
  report: { tile: Tile; seq: number },
  lastPos: Vec2 | null,
  ore: OreGrid,
  now: number,
): number {
  if (report.seq <= guard.seq) return 0; // stale or duplicate
  guard.seq = report.seq;
  if (oreAt(ore, report.tile) !== "metal") return 0;
  if (now - guard.lastAt < MINE_CADENCE_MS) return 0; // too soon
  if (lastPos && !withinReach(tileCenter(report.tile), lastPos, INTERACT_REACH)) return 0;
  guard.lastAt = now;
  return 1;
}

export function withinReach(target: Vec2, from: Vec2, reach: number): boolean {
  return Math.hypot(target.x - from.x, target.y - from.y) <= reach;
}

// What is under the cursor, for the two buttons that reach for it: left-click mines (#120) and
// right-click demolishes, and each takes only its own half of this answer.
//
// A structure always wins over the ore beneath it — a miner sits on metal ore by definition, so
// resolving ore first would make it undemolishable, and it is what keeps left-click from digging
// out from under a standing miner now that the button pulling one down is the other one. Bare
// ground and power ore yield nothing.
export type HarvestTarget = { kind: "mine"; tile: Tile } | { kind: "demolish"; id: string } | null;

export function resolveHarvest(tile: Tile, ore: OreGrid, build: BuildState | null): HarvestTarget {
  const id = build?.occupancy.get(tileKey(tile));
  if (id !== undefined) return { kind: "demolish", id };
  return oreAt(ore, tile) === "metal" ? { kind: "mine", tile } : null;
}

// What ore a tile *is*, as far as anything looking at it can tell — both kinds, and nothing at all
// where a building covers the ground (#134).
//
// The same question `resolveHarvest` answers, asked the other way round. That one says what a
// *button* would do, so power ore is nothing to it: there is no hand-mine path for Energy. A hover
// has to name the tile whether or not a button could act on it, and it has to stay silent about ore
// buried under a miner for the same reason the resolver gives that tile to the demolish button.
export function oreUnder(tile: Tile, ore: OreGrid, build: BuildState | null): OreKind | null {
  if (build?.occupancy.has(tileKey(tile))) return null;
  return oreAt(ore, tile);
}

// --- The buildables ----------------------------------------------------------------------
// One table drives the whole build path: the bar, the ghost's validity test, and server-side
// admission all read it, so a new buildable is an entry here plus its own behaviour — never a
// second pass over the UI.

// Bar order, which is also what the 1–4 keys select. A kind absent from BUILDABLES has not
// shipped yet: its slot renders, but nothing will place.
export const BUILD_SLOTS: readonly BuildableKind[] = ["miner", "wall", "turret", "generator"];

export interface BuildableSpec {
  footprint: number; // side length in tiles; every buildable is square
  cost: number; // Metal, spent from the shared bank. Every building costs Metal only.
  hp: number;
  requires: OreKind | null; // the ore at least one tile under the footprint must be
}

export const MINER_TRICKLE = 2; // metal/s — it never stops and it stacks
export const GENERATOR_OUTPUT = 400; // energy/s of ceiling each standing generator contributes

// Turret fire. Range matches the player's own reach.
//
// **Both figures below are unchanged by #80, and the claim they carried is not.** A turret's shot
// travels now and can miss, and a turret is the shooter it misses *for*: it shoots at whatever is
// nearest, which is usually chasing a player somewhere else and so crossing its line, where a
// player's target is almost always closing along it. That a crossing target escapes is proved on
// the geometry — `enemies.test.ts` "a target crossing at elite speed at maximum range outruns a
// turret's shot too", against its standing-still twin.
//
// **How often it happens is not a figure this repo can hand you.** The one measurement of it is not
// reproducible, and ADR 0007 says so and says why: the rate rides enemy density and where the
// turret stands rather than anything about the gun. So "~20 dps kills a 30 HP grunt in ~1.5 s" is
// now a **ceiling** rather than a rate — a turret that never missed would be exactly that, and a
// real one is somewhere under it. Neither number below was raised to buy the difference back, at
// any size it turns out to be. Missing is the whole of what #80 adds, and a turret is the only
// place it bites; compensating it away in the damage would leave the game where it was with a
// flight simulation bolted on. Both are provisional as they always were — a later change is a retune.
//
// **What a miss costs is time, and only time (#155).** A turret's shot is free: it takes nothing
// from the squad's ammo pool and nothing from the bank, so the unpriceable miss rate above is not
// an economic quantity at all — it stretches the ceiling out, and stops there. Between #102 and
// #155 a turret did spend a bullet, which put a Metal price on every miss and contradicted #80's
// own scoping; `enemies.test.ts` "#155: a turret's shot costs no Metal and no bullet" is what now
// makes bringing that back a failure. The price of a turret's fire is power — see the draw below.
export const TURRET_RANGE = 700;
export const TURRET_DAMAGE = 4;
export const TURRET_CADENCE_MS = 200;

// Turrets are gated by energy at run time, not at build time. A standing turret draws a little
// simply for existing; one holding a target draws a lot, continuously — not per shot. The
// practical shape: your grid supports a limited number of *simultaneously firing* turrets, and a
// big wave is exactly when demand spikes.
export const TURRET_IDLE_DRAW = 10;
export const TURRET_ACTIVE_DRAW = 100;

export const BUILDABLES: Partial<Record<BuildableKind, BuildableSpec>> = {
  miner: { footprint: 2, cost: 50, hp: 200, requires: "metal" },
  wall: { footprint: 2, cost: 10, hp: 400, requires: null },
  generator: { footprint: 5, cost: 150, hp: 300, requires: "power" },
  turret: { footprint: 2, cost: 60, hp: 250, requires: null },
};

// What a turret's price is multiplied by for each turret the squad already has standing (#101).
// Provisional, like every balance number: a later value is a retune, not a correction.
export const TURRET_COST_GROWTH = 1.3;

function countKind(build: BuildState, kind: BuildableKind): number {
  let count = 0;
  for (const s of build.structures.values()) if (s.kind === kind) count++;
  return count;
}

// What `kind` costs the squad *right now* — the one number the build bar, the placement ghost and
// server-side admission all read, so none of them can quote a price another would refuse. Only the
// turret escalates; every other buildable is its registry cost flat.
//
// The count is taken from the live structure map rather than tallied, so a turret leaving by any
// route — demolished, or chewed down by an enemy — drops the price the same tick, and it is the
// squad's turrets that are counted because the map is the squad's.
//
// Growth is applied by repeated multiplication rather than `**`: IEEE multiplication is exact,
// while `Math.pow` is only implementation-approximated, so this is the form that cannot round to a
// different whole Metal in the browser than it does on the server. Same reason `mulberry32` uses
// `Math.imul`.
export function buildCost(kind: BuildableKind, build: BuildState): number {
  const base = BUILDABLES[kind]?.cost ?? 0;
  if (kind !== "turret") return base;
  let cost = base;
  for (let standing = countKind(build, "turret"); standing > 0; standing--) {
    cost *= TURRET_COST_GROWTH;
  }
  return Math.round(cost);
}

// A turret's live state. `cooldownMs` counts down to its next shot on the injected `dtMs` rather
// than a clock, like an enemy's `biteMs`. `powered` is whether it has won an activation slot;
// `targetId` is the enemy or nest it is holding, and losing that target is what releases the
// power. Only turrets carry this, so walls and miners stay free of turret fields.
export interface TurretRuntime {
  cooldownMs: number;
  powered: boolean;
  targetId: string | null;
}

// --- Ammo ---------------------------------------------------------------------------------
// The squad's bullets, and the forge that makes them. One pool for the whole squad: a bullet
// belongs to whichever shot is admitted first, not to whoever paid for it. Players draw on it and
// turrets do not — a turret's shot is priced in power alone (#155).

// What a bullet costs and how long it takes to forge. Provisional, like every balance number: a
// later value is a retune, not a correction.
export const BULLET_COST = 5; // Metal, charged at enqueue
export const FORGE_MS = 1_000; // one bullet at a time, serially

export interface Ammo {
  bullets: number; // forged and spendable now
  queued: number; // ordered and paid for, still being forged
  forgeMs: number; // time left on the bullet at the head of the queue; 0 when nothing is queued
}

// Order one bullet: the Metal leaves the bank now and the bullet arrives FORGE_MS later. Returns
// whether the squad could afford it.
//
// Charging at enqueue rather than on delivery is what makes the queue the squad's rather than the
// buyer's — nothing here records who ordered it, so there is nobody to refund and no owner whose
// death or disconnect the queue could be tied to.
export function enqueueForge(build: BuildState): boolean {
  if (build.bank.metal < BULLET_COST) return false;
  build.bank.metal -= BULLET_COST;
  if (build.ammo.queued === 0) build.ammo.forgeMs = FORGE_MS;
  build.ammo.queued++;
  return true;
}

// Advance the forge one tick. Overflow carries into the next bullet the way the wave clock re-arms,
// so a queue is paced by the time it was given rather than by how the ticks happened to fall.
function stepForge(ammo: Ammo, dtMs: number): void {
  if (ammo.queued === 0) return;
  ammo.forgeMs -= dtMs;
  while (ammo.forgeMs <= 0 && ammo.queued > 0) {
    ammo.queued--;
    ammo.bullets++;
    ammo.forgeMs += FORGE_MS;
  }
  if (ammo.queued === 0) ammo.forgeMs = 0; // an idle forge holds no clock for the next order
}

// Take one bullet, or refuse. The check and the take are one indivisible step for the same reason
// `ActivationQueue` reserves power in one: two shots resolved in the same tick must not both see
// the last bullet.
export function spendBullet(ammo: Ammo): boolean {
  if (ammo.bullets <= 0) return false;
  ammo.bullets--;
  return true;
}

// Throw the queue away. The Metal went at enqueue and there is no refund path anywhere, so the
// bullets in flight are simply lost — which is what the match ending does to them.
export function drainForge(ammo: Ammo): void {
  ammo.queued = 0;
  ammo.forgeMs = 0;
}

// A placed building. `tile` is the top-left of its square footprint; `hp` is sim-owned.
export interface Structure {
  id: string;
  kind: BuildableKind;
  tile: Tile;
  hp: number;
  turret?: TurretRuntime;
}

// Everything the squad owns. Both sides hold one: the server's is authoritative, and each
// client mirrors it from the deltas so the ghost can test placement without a round-trip.
export interface BuildState {
  arena: Arena;
  structures: Map<string, Structure>;
  occupancy: Map<number, string>; // tileKey → structure id, so overlap is a lookup, not a scan
  bank: Bank; // whole Metal only; `creditMetal` is the sole way in
  metalThousandths: number; // the unbanked remainder, in [0, 1000). Owned by `creditMetal`.
  // The squad's bullets. `bullets` and `queued` both stream; `forgeMs` is server-only, so a
  // client's mirror carries it at zero — the same shape `metalThousandths` already has. The
  // countdown stays behind because it moves every tick, and the client reconstructs the phase it
  // needs from `FORGE_MS` and the arrival that restarted the head bullet (#102).
  ammo: Ammo;
  power: Power;
  nextId: number;
}

export function freshBuildState(arena: Arena): BuildState {
  return {
    arena,
    structures: new Map(),
    occupancy: new Map(),
    bank: { metal: 0 },
    metalThousandths: 0,
    ammo: { bullets: 0, queued: 0, forgeMs: 0 },
    power: { generation: 0, consumption: 0 },
    nextId: 1,
  };
}

// Every tile a building of this kind at `tile` would cover.
export function footprintTiles(tile: Tile, footprint: number): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) tiles.push({ tx: tile.tx + dx, ty: tile.ty + dy });
  }
  return tiles;
}

// The world-space center of a footprint, used for reach checks and for drawing.
export function footprintCenter(tile: Tile, footprint: number): Vec2 {
  const half = (footprint * TILE) / 2;
  return { x: tile.tx * TILE + half, y: tile.ty * TILE + half };
}

export function structureCenter(s: Structure): Vec2 {
  return footprintCenter(s.tile, BUILDABLES[s.kind]?.footprint ?? 1);
}

// A structure's half-extent, treated as a circle for the sim's range and contact tests. Close
// enough for a square footprint, and it keeps every distance check one `hypot`.
export function structureRadius(s: Structure): number {
  return ((BUILDABLES[s.kind]?.footprint ?? 1) * TILE) / 2;
}

// Why a placement is refused, or null if it is legal. The ghost colours itself from this and
// server-side admission gates on it, so the two can never disagree about what is placeable.
export type PlacementError =
  | "unknown-buildable"
  | "unaffordable"
  | "out-of-bounds"
  | "blocked"
  | "wrong-ore"
  | "out-of-reach"
  | null;

export function placementError(
  kind: BuildableKind,
  tile: Tile,
  ore: OreGrid,
  build: BuildState,
  from: Vec2 | null,
): PlacementError {
  const spec = BUILDABLES[kind];
  if (!spec) return "unknown-buildable";
  if (build.bank.metal < buildCost(kind, build)) return "unaffordable";
  const maxTile = Math.floor(Math.min(build.arena.width, build.arena.height) / TILE) - 1;
  const tiles = footprintTiles(tile, spec.footprint);
  for (const t of tiles) {
    if (t.tx < 0 || t.ty < 0 || t.tx > maxTile || t.ty > maxTile) return "out-of-bounds";
    if (build.occupancy.has(tileKey(t))) return "blocked";
  }
  // Any one tile under the footprint being the right ore is enough, so a big patch hosts
  // several harvesters side by side and a 5×5 may straddle a patch edge.
  if (spec.requires && !tiles.some((t) => oreAt(ore, t) === spec.requires)) return "wrong-ore";
  if (from && !withinReach(footprintCenter(tile, spec.footprint), from, INTERACT_REACH)) {
    return "out-of-reach";
  }
  return null;
}

// Per-player build admission state, separate from mining so one verb can't rate-limit the other.
export interface BuildGuard {
  seq: number;
  lastAt: number;
}

export const BUILD_CADENCE_MS = 100; // server-side floor on how often a client may place

export function freshBuildGuard(): BuildGuard {
  return { seq: -1, lastAt: Number.NEGATIVE_INFINITY };
}

// Decide whether to accept a reported placement, mutating `guard` as a side effect (the
// `admitAttack` idiom). Returns the spec so the caller can place without a second lookup — its HP
// and footprint, not its price: what a placement is charged is `buildCost`, re-derived at the
// debit. Null if the placement is refused.
export function admitBuild(
  guard: BuildGuard,
  report: { kind: BuildableKind; tile: Tile; seq: number },
  lastPos: Vec2 | null,
  ore: OreGrid,
  build: BuildState,
  now: number,
): BuildableSpec | null {
  if (report.seq <= guard.seq) return null; // stale or duplicate
  guard.seq = report.seq;
  if (now - guard.lastAt < BUILD_CADENCE_MS) return null; // too soon
  if (placementError(report.kind, report.tile, ore, build, lastPos) !== null) return null;
  guard.lastAt = now;
  return BUILDABLES[report.kind] ?? null;
}

// Place a building and debit the bank. The caller must have admitted it first — this is the
// mutation, not the decision.
export function placeStructure(
  build: BuildState,
  kind: BuildableKind,
  tile: Tile,
  spec: BuildableSpec,
): Structure {
  // Priced before the insert, so the turret being paid for is not counted against its own price.
  build.bank.metal -= buildCost(kind, build);
  return insertStructure(build, { id: `b${build.nextId++}`, kind, tile, hp: spec.hp });
}

// Add a structure the server already minted an id for — the client's path when a `builds` event
// or the reconnect keyframe arrives, and the tail of `placeStructure` on the server.
export function insertStructure(build: BuildState, spawn: StructureSpawn): Structure {
  const structure: Structure = { ...spawn, tile: { ...spawn.tile } };
  if (structure.kind === "turret") {
    structure.turret = { cooldownMs: 0, powered: false, targetId: null };
  }
  build.structures.set(structure.id, structure);
  const spec = BUILDABLES[structure.kind];
  if (spec) {
    for (const t of footprintTiles(structure.tile, spec.footprint)) {
      build.occupancy.set(tileKey(t), structure.id);
    }
  }
  return structure;
}

// Remove a structure and free its tiles immediately, so a rebuild on the same footprint is legal
// the very same tick.
export function removeStructure(build: BuildState, id: string): Structure | null {
  const structure = build.structures.get(id);
  if (!structure) return null;
  build.structures.delete(id);
  const spec = BUILDABLES[structure.kind];
  if (spec) {
    for (const t of footprintTiles(structure.tile, spec.footprint))
      build.occupancy.delete(tileKey(t));
  }
  return structure;
}

// --- Banking Metal --------------------------------------------------------------------------
// The bank holds whole Metal and nothing else, so a 4.9999 balance cannot exist and every
// affordability test is an integer comparison. Income is fractional, though — a miner earns 0.2
// Metal on a 50 ms tick — so the sub-unit remainder is carried here rather than dropped, and the
// squad is paid its exact rate no matter how the ticks fall.

// The remainder is counted in thousandths of a Metal because that is the exact quantum every
// producer lands on: rates are whole Metal per second and the clock is whole milliseconds, so
// `rate × ms` is always an integer count of thousandths. Accumulating that integer is what makes
// the total exact — carrying the remainder as a plain float instead banks 119 of an earned 120
// over ten seconds, because 0.6 added two hundred times lands at 119.99999999999973.
const THOUSANDTHS_PER_METAL = 1_000;

// Anything carrying an unbanked remainder. `BuildState` is one; #99's per-miner counters are the
// others, which is why this is a shape rather than a field of the bank.
export interface MetalAccrual {
  metalThousandths: number;
}

// Take the whole Metal that `metal` completes, leaving the sub-unit remainder behind. The one place
// a whole-Metal crossing is decided: `creditMetal` banks what this returns and #99 floats a `+1` on
// it, so a cosmetic derived per miner counts the same crossings the shared bank is paid on.
export function accrueMetal(accrual: MetalAccrual, metal: number): number {
  accrual.metalThousandths += Math.round(metal * THOUSANDTHS_PER_METAL);
  const whole = Math.floor(accrual.metalThousandths / THOUSANDTHS_PER_METAL);
  accrual.metalThousandths -= whole * THOUSANDTHS_PER_METAL;
  return whole;
}

// Pay Metal into the shared bank, returning the whole Metal that just landed in it — 0 on a tick
// that only moved the remainder.
export function creditMetal(build: BuildState, metal: number): number {
  const whole = accrueMetal(build, metal);
  build.bank.metal += whole;
  return whole;
}

// Advance the economy one tick: miners trickle Metal into the shared bank, the forge delivers
// whatever it finished, and the energy ceiling is recomputed from the generators actually standing.
// Recomputing rather than accumulating is what makes Energy a rate and not a bank — a generator
// destroyed or demolished drops the ceiling the same tick, with no reserve left over. Deterministic
// in (state, dtMs); no clock.
//
// Returns the whole Metal that crossed into the bank this tick, usually 0.
export function stepBuild(build: BuildState, dtMs: number): number {
  const banked = creditMetal(build, (metalRate(build) * dtMs) / 1000);
  stepForge(build.ammo, dtMs);
  build.power.generation = countKind(build, "generator") * GENERATOR_OUTPUT;
  return banked;
}

// Metal per second the standing miners pay into the bank: what `stepBuild` accumulates, stated as a
// rate, so a reading of it cannot drift from what the bank is actually being paid.
//
// Hand-mining is deliberately not in it. It is HAND_MINE_RATE while a button is held and 0 the
// instant it is let go, so folding it in would make the readout flicker with whoever is digging —
// a worse answer to "is one more miner worth it" than no readout at all.
export function metalRate(build: BuildState): number {
  return countKind(build, "miner") * MINER_TRICKLE;
}

// --- Solidity ------------------------------------------------------------------------------
// All four buildings are solid, and solidity is the one piece of structure state both sides of
// the authority split need: the client clamps your avatar against it, the sim stops enemies with
// it. One occupancy test, consumed by both, so the two can never disagree about what is passable.

export function solidAt(build: BuildState, tile: Tile): boolean {
  return build.occupancy.has(tileKey(tile));
}

// The structure a circle at `pos` overlaps, or null. Only the tiles under the circle's bounding
// box are probed, so cost is fixed regardless of how much the squad has built.
export function structureBlocking(
  build: BuildState | null,
  pos: Vec2,
  radius: number,
): Structure | null {
  if (!build || build.occupancy.size === 0) return null;
  const min = tileOf({ x: pos.x - radius, y: pos.y - radius });
  const max = tileOf({ x: pos.x + radius, y: pos.y + radius });
  for (let ty = min.ty; ty <= max.ty; ty++) {
    for (let tx = min.tx; tx <= max.tx; tx++) {
      const id = build.occupancy.get(tileKey({ tx, ty }));
      if (id === undefined) continue;
      if (circleTouchesTile(pos, radius, tx, ty)) return build.structures.get(id) ?? null;
    }
  }
  return null;
}

// Move a circle from `from` toward `to`, refusing whichever axes would put it inside a structure.
// Resolving the axes separately is what makes you slide along a wall rather than stick to it, and
// what guarantees a corner is never a hard trap: the free axis always remains free.
export function slidePos(build: BuildState | null, from: Vec2, to: Vec2, radius: number): Vec2 {
  if (!build || build.occupancy.size === 0) return to;
  let x = from.x;
  if (!structureBlocking(build, { x: to.x, y: from.y }, radius)) x = to.x;
  let y = from.y;
  if (!structureBlocking(build, { x, y: to.y }, radius)) y = to.y;
  return { x, y };
}

// Shove a circle clear of the structure it spawned inside, along whichever axis it is closest to
// escaping. Deliberately one push and no search for a free tile: a wave spawning inside a walled
// -in nest still spawns, it just does not stay stuck in the wall.
export function pushOutOfSolids(build: BuildState | null, pos: Vec2, radius: number): Vec2 {
  const blocker = structureBlocking(build, pos, radius);
  if (!blocker) return pos;
  const center = structureCenter(blocker);
  const clear = structureRadius(blocker) + radius;
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  if (clear - Math.abs(dx) < clear - Math.abs(dy)) {
    return { x: center.x + sign(dx) * clear, y: pos.y };
  }
  return { x: pos.x, y: center.y + sign(dy) * clear };
}

// A zero offset means the circle sits dead centre; break the tie consistently so the push is
// deterministic rather than dependent on the sign of a floating-point zero.
function sign(value: number): number {
  return value < 0 ? -1 : 1;
}

// Circle-vs-tile overlap: clamp the circle's centre into the tile's rect and measure. Exact
// tangency is deliberately *not* an overlap — that keeps this in step with the bounding-box tile
// range `structureBlocking` probes, which would otherwise miss a tile the circle only grazes.
function circleTouchesTile(pos: Vec2, radius: number, tx: number, ty: number): boolean {
  const nearestX = Math.max(tx * TILE, Math.min(pos.x, (tx + 1) * TILE));
  const nearestY = Math.max(ty * TILE, Math.min(pos.y, (ty + 1) * TILE));
  return Math.hypot(pos.x - nearestX, pos.y - nearestY) < radius;
}

// --- Demolish ------------------------------------------------------------------------------
// The only way to undo anything in M4: it is how you repair (there is none — you demolish and
// rebuild), how you dig yourself out after walling yourself in, how you reopen a door you sealed,
// and how you recover from over-building past the power ceiling.

export const DEMOLISH_REFUND = 0.2;
export const DEMOLISH_CADENCE_MS = 100;
// How long the pulling-down itself takes is not here: it is the building's harvest progress, which
// is client-local and lives with the ore's in `harvest.ts` (#130). A request reaching this file is
// one that has already been earned.

export interface DemolishGuard {
  seq: number;
  lastAt: number;
}

export function freshDemolishGuard(): DemolishGuard {
  return { seq: -1, lastAt: Number.NEGATIVE_INFINITY };
}

// Decide whether to accept a reported demolish, mutating `guard` as a side effect. There is no
// ownership check: structures are communal state like the bank, so any player may demolish any
// structure. Returns the structure so the caller can refund and remove it.
export function admitDemolish(
  guard: DemolishGuard,
  report: { id: string; seq: number },
  lastPos: Vec2 | null,
  build: BuildState,
  now: number,
): Structure | null {
  if (report.seq <= guard.seq) return null; // stale or duplicate
  guard.seq = report.seq;
  if (now - guard.lastAt < DEMOLISH_CADENCE_MS) return null; // too soon
  const structure = build.structures.get(report.id);
  if (!structure) return null; // already gone — a duplicate refunds nothing rather than erroring
  if (lastPos && !withinReach(structureCenter(structure), lastPos, INTERACT_REACH)) return null;
  guard.lastAt = now;
  return structure;
}

// Remove a structure and credit the refund. Rounded down, so a cheap building can refund nothing.
//
// Deliberately the registry price, not `buildCost`: what a turret cost when it went up is not
// recoverable — the standing count has moved since — and #101 asked only that the price of the
// *next* turret escalate. A refund basis for an escalating cost is an open question, not a default.
export function demolishStructure(build: BuildState, structure: Structure): number {
  const refund = Math.floor((BUILDABLES[structure.kind]?.cost ?? 0) * DEMOLISH_REFUND);
  removeStructure(build, structure.id);
  creditMetal(build, refund);
  return refund;
}

// --- The power budget ------------------------------------------------------------------------
// Turret activation is admitted through a queue, drained one request at a time, each performing
// its "is there free power?" check *and* its reservation in a single indivisible step. That
// indivisibility is the whole point: an event/pub-sub design would let two turrets both see the
// same free slot before either claimed it. No locks are needed — the runtime's single-threaded
// tick supplies the atomicity; the queue supplies the order.
export class ActivationQueue {
  private readonly pending: Structure[] = [];

  // `reserved` starts at what is already committed this tick: every turret's idle draw, plus the
  // active draw of every turret that is already firing. Those are never re-queued and never bumped.
  constructor(
    private readonly generation: number,
    private reserved: number,
  ) {}

  request(turret: Structure): void {
    this.pending.push(turret);
  }

  // Whoever requested first gets the power. A turret that finds no headroom simply does not
  // activate: it keeps standing, drawing idle, doing nothing. That is recoverable, not a failure.
  drain(): void {
    for (const turret of this.pending) {
      if (this.reserved + TURRET_ACTIVE_DRAW > this.generation) continue;
      this.reserved += TURRET_ACTIVE_DRAW;
      if (turret.turret) turret.turret.powered = true;
    }
    this.pending.length = 0;
  }

  get committed(): number {
    return this.reserved;
  }
}

// Every structure, shaped for the reconnect keyframe. Tiles are copied so the snapshot never
// aliases live state.
export function snapshotStructures(build: BuildState): StructureSpawn[] {
  return [...build.structures.values()].map((s) => ({
    id: s.id,
    kind: s.kind,
    tile: { ...s.tile },
    hp: s.hp,
  }));
}

// The engaged turrets' aims, for the same keyframe. Aim transitions are sparse relative to how
// long a target is held, so a reconnecter who missed one would otherwise see a turret siege a nest
// with no line at all.
//
// An idle turret is absent, and loses nothing by it: `powered` is never true without a target —
// `stepTurrets` releases the slot the instant the target is lost — so an omitted turret is exactly
// the unpowered, un-aimed one that `insertStructure` already mints. The corollary is that
// `powered` is only meaningful alongside a target, which is also how both things that read it (the
// line and the unpowered-lightning) already treat it.
export function snapshotAims(build: BuildState): TurretAim[] {
  const aims: TurretAim[] = [];
  for (const s of build.structures.values()) {
    if (s.turret && s.turret.targetId !== null) {
      aims.push([s.id, s.turret.targetId, s.turret.powered ? 1 : 0]);
    }
  }
  return aims;
}
