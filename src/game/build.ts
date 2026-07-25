import type {
  Arena,
  Bank,
  BuildableKind,
  OreKind,
  StructureSpawn,
  Tile,
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
function mulberry32(seed: number): () => number {
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

// Right-click is one verb: holding it harvests whatever is under the cursor. This resolves
// which. Metal ore hand-mines; bare ground and power ore yield nothing. A structure will resolve
// ahead of the ore beneath it once demolish lands — a miner sits on metal ore by definition, so
// resolving ore first would make it undemolishable.
export type HarvestTarget = { kind: "mine"; tile: Tile } | null;

export function resolveHarvest(tile: Tile, ore: OreGrid): HarvestTarget {
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

export const BUILDABLES: Partial<Record<BuildableKind, BuildableSpec>> = {
  miner: { footprint: 2, cost: 50, hp: 200, requires: "metal" },
};

// A placed building. `tile` is the top-left of its square footprint; `hp` is sim-owned.
export interface Structure {
  id: string;
  kind: BuildableKind;
  tile: Tile;
  hp: number;
}

// Everything the squad owns. Both sides hold one: the server's is authoritative, and each
// client mirrors it from the deltas so the ghost can test placement without a round-trip.
export interface BuildState {
  arena: Arena;
  structures: Map<string, Structure>;
  occupancy: Map<number, string>; // tileKey → structure id, so overlap is a lookup, not a scan
  bank: Bank;
  nextId: number;
}

export function freshBuildState(arena: Arena): BuildState {
  return { arena, structures: new Map(), occupancy: new Map(), bank: { metal: 0 }, nextId: 1 };
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
  const structure: Structure = { id: `b${build.nextId++}`, kind, tile, hp: spec.hp };
  build.bank.metal -= spec.cost;
  insertStructure(build, structure);
  return structure;
}

// Add a structure the server already minted an id for — the client's path when a `builds` event
// or the reconnect keyframe arrives.
export function insertStructure(build: BuildState, structure: Structure): void {
  build.structures.set(structure.id, structure);
  const spec = BUILDABLES[structure.kind];
  if (!spec) return;
  for (const t of footprintTiles(structure.tile, spec.footprint)) {
    build.occupancy.set(tileKey(t), structure.id);
  }
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

// Advance the economy one tick: every miner trickles Metal into the shared bank. Deterministic
// in (state, dtMs) — no clock — so it steps as fast as a test wants.
export function stepBuild(build: BuildState, dtMs: number): void {
  let miners = 0;
  for (const s of build.structures.values()) if (s.kind === "miner") miners++;
  if (miners > 0) build.bank.metal += (miners * MINER_TRICKLE * dtMs) / 1000;
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
