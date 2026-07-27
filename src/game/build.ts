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

export type OreGrid = Map<number, OreKind>;

export function tileKey(tile: Tile): number {
  return tile.tx * KEY_STRIDE + tile.ty;
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

// --- Ore generation ---------------------------------------------------------------------
// Patches are blobs grown by accretion from a seed tile, scattered with a real center→edge
// gradient: DESIGN.md puts the riches at the dangerous wall, so pushing outward pays. A handful
// of patches are reserved for the center so a squad that has just spawned can always bootstrap.

const METAL_PATCHES = 140;
const METAL_PATCH_MIN = 30;
const METAL_PATCH_MAX = 80;
const POWER_PATCHES = 40; // power ore is smaller and sparser than metal, per the spec
const POWER_PATCH_MIN = 10;
const POWER_PATCH_MAX = 20;

// Patch centers sit at `frac` of the arena half-extent, in the max-norm — the same square
// projection `nestLayout` uses, so ore and nests share one notion of "how far out".
const ORE_MAX_FRAC = 1 - DANGER_BAND_FRAC / 2; // patches reach past the nest ring, short of the wall
const ORE_MIN_FRAC = 0.02;
// Radial fraction is sampled as u^(1/EDGE_BIAS): the areal density then grows toward the wall
// instead of thinning out as the rings get longer.
const EDGE_BIAS = 3.5;
const BOOTSTRAP_PATCHES = 4; // metal patches pinned near center; the rest follow the gradient
const BOOTSTRAP_MAX_FRAC = 0.06;

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Seed the arena's ore. Power patches are placed first so they stay whole — metal is common
// enough that the holes it inherits don't matter, and a tile is only ever one kind.
export function generateOre(arena: Arena, seed: number): OreGrid {
  const rng = mulberry32(seed);
  const grid: OreGrid = new Map();
  const maxTile = Math.floor(Math.min(arena.width, arena.height) / TILE) - 1;
  for (let i = 0; i < POWER_PATCHES; i++) {
    growPatch(
      grid,
      "power",
      patchSeedTile(arena, rng, false),
      size(rng, POWER_PATCH_MIN, POWER_PATCH_MAX),
      rng,
      maxTile,
    );
  }
  for (let i = 0; i < METAL_PATCHES; i++) {
    const bootstrap = i < BOOTSTRAP_PATCHES;
    growPatch(
      grid,
      "metal",
      patchSeedTile(arena, rng, bootstrap),
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
function patchSeedTile(arena: Arena, rng: () => number, bootstrap: boolean): Tile {
  const angle = rng() * Math.PI * 2;
  const frac = bootstrap
    ? ORE_MIN_FRAC + rng() * (BOOTSTRAP_MAX_FRAC - ORE_MIN_FRAC)
    : ORE_MIN_FRAC + rng() ** (1 / EDGE_BIAS) * (ORE_MAX_FRAC - ORE_MIN_FRAC);
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
// Holding right-click on a metal-ore tile mines it straight into the shared bank. Power ore has
// no hand-mine path at all: Energy is a live rate with nowhere to store what you'd dig up.

export const HAND_MINE_RATE = 8; // metal per second held
export const MINE_CADENCE_MS = 100; // server-side floor on how often a client may report mining
export const MINE_WINDOW_MAX_MS = 250; // caps the accrual after a pause, so idling banks nothing
// The one loose reach shared by mining, building and demolishing. "Whatever is on screen" is
// unknowable server-side, so — like ATTACK_POS_TOLERANCE — this is an anti-teleport bound, not
// an exact reach.
export const INTERACT_REACH = 2_000;

// Per-player hand-mine admission state. `seq` guards apply-if-newer; `lastAt` is both the cadence
// floor and the accrual clock.
export interface MineGuard {
  seq: number;
  lastAt: number;
}

export function freshMineGuard(): MineGuard {
  return { seq: -1, lastAt: Number.NEGATIVE_INFINITY };
}

// How much Metal a reported hand-mine earns, or 0 if it is not admitted. Mutating `guard` as a
// side effect mirrors `admitAttack`. Yield is time-based rather than per-message, so a client
// that spams `game/mine` earns exactly what one mining at the honest cadence does.
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
  const elapsed = now - guard.lastAt;
  if (elapsed < MINE_CADENCE_MS) return 0; // too soon; the accrual clock is left untouched
  if (lastPos && !withinReach(tileCenter(report.tile), lastPos, INTERACT_REACH)) return 0;
  guard.lastAt = now;
  if (!Number.isFinite(elapsed)) return 0; // the very first report only starts the clock
  return (Math.min(elapsed, MINE_WINDOW_MAX_MS) / 1000) * HAND_MINE_RATE;
}

function withinReach(target: Vec2, from: Vec2, reach: number): boolean {
  return Math.hypot(target.x - from.x, target.y - from.y) <= reach;
}

// Right-click is one verb: holding it harvests whatever is under the cursor. This resolves which.
// A structure always wins over the ore beneath it — a miner sits on metal ore by definition, so
// resolving ore first would make it undemolishable. Bare ground and power ore yield nothing.
export type HarvestTarget = { kind: "mine"; tile: Tile } | { kind: "demolish"; id: string } | null;

export function resolveHarvest(tile: Tile, ore: OreGrid, build: BuildState | null): HarvestTarget {
  const id = build?.occupancy.get(tileKey(tile));
  if (id !== undefined) return { kind: "demolish", id };
  return oreAt(ore, tile) === "metal" ? { kind: "mine", tile } : null;
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

export const MINER_TRICKLE = 4; // metal/s — half the hand rate, but it never stops and it stacks
export const GENERATOR_OUTPUT = 400; // energy/s of ceiling each standing generator contributes

// Turret fire. Range matches the player's own reach, and ~20 dps kills a 30 HP grunt in ~1.5 s.
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
  turret: { footprint: 2, cost: 120, hp: 250, requires: null },
};

// A turret's live state. `cooldownMs` counts down to its next shot on the injected `dtMs` rather
// than a clock, like an enemy's `biteMs`. `powered` is whether it has won an activation slot;
// `targetId` is the enemy or nest it is holding, and losing that target is what releases the
// power. Only turrets carry this, so walls and miners stay free of turret fields.
export interface TurretRuntime {
  cooldownMs: number;
  powered: boolean;
  targetId: string | null;
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
  bank: Bank;
  power: Power;
  nextId: number;
}

export function freshBuildState(arena: Arena): BuildState {
  return {
    arena,
    structures: new Map(),
    occupancy: new Map(),
    bank: { metal: 0 },
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
  if (build.bank.metal < spec.cost) return "unaffordable";
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
// `admitAttack` idiom). Returns the spec so the caller can debit and place without a second
// lookup, or null if the placement is refused.
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
  build.bank.metal -= spec.cost;
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

// Advance the economy one tick: miners trickle Metal into the shared bank, and the energy ceiling
// is recomputed from the generators actually standing. Recomputing rather than accumulating is
// what makes Energy a rate and not a bank — a generator destroyed or demolished drops the ceiling
// the same tick, with no reserve left over. Deterministic in (state, dtMs); no clock.
export function stepBuild(build: BuildState, dtMs: number): void {
  let generators = 0;
  for (const s of build.structures.values()) if (s.kind === "generator") generators++;
  build.bank.metal += (metalRate(build) * dtMs) / 1000;
  build.power.generation = generators * GENERATOR_OUTPUT;
}

// Metal per second the standing miners pay into the bank: what `stepBuild` accumulates, stated as a
// rate, so a reading of it cannot drift from what the bank is actually being paid.
//
// Hand-mining is deliberately not in it. It is 8/s while a button is held and 0 the instant it is
// let go, so folding it in would make the readout jump between nothing and 30-odd depending on who
// is digging — a worse answer to "is one more miner worth it" than no readout at all.
export function metalRate(build: BuildState): number {
  let miners = 0;
  for (const s of build.structures.values()) if (s.kind === "miner") miners++;
  return miners * MINER_TRICKLE;
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
// Holding is what makes demolish safe: a stray right-click while running over your own wall must
// not delete it. The client withholds the request until the button has been down this long.
export const DEMOLISH_HOLD_MS = 350;

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
export function demolishStructure(build: BuildState, structure: Structure): number {
  const refund = Math.floor((BUILDABLES[structure.kind]?.cost ?? 0) * DEMOLISH_REFUND);
  removeStructure(build, structure.id);
  build.bank.metal += refund;
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
