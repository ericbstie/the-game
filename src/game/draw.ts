import type {
  BuildableKind,
  EnemyKind,
  OreKind,
  PlayerId,
  Tile,
  WorldSnapshot,
} from "../lobby/protocol";
import { BUILDABLES, footprintCenter, oreAt, TILE, tileOf } from "./build";
import { type Camera, isVisible, type Viewport } from "./camera";

// Pure canvas rendering: turn a WorldSnapshot into 2D draw calls in WORLD coordinates. The
// caller pre-translates the context to the camera (so 1 world unit = 1 CSS px), so this
// draws in world space and never sees the camera transform. Off-screen entities are culled
// and the clear/fill is bounded to the viewport, keeping cost independent of world size. No
// React, no DOM, no state — it renders identically in the browser and under a spy context.
// M2 is basic shapes only; sprites are Milestone 5.

// The tile-snapped preview under the cursor while a buildable is selected. `valid` drives the
// colour, so the player learns a placement is refused before spending the click.
export interface BuildGhost {
  kind: BuildableKind;
  tile: Tile;
  valid: boolean;
}

export interface DrawOptions {
  camera: Camera;
  viewport: Viewport;
  selfId?: PlayerId; // ringed so you can find yourself
  ghost?: BuildGhost;
}

// One stable colour per slot (1..6), so a player keeps their colour across the match.
const SLOT_COLORS = ["#4f8cff", "#ff5d5d", "#40c463", "#f2c14e", "#c77dff", "#4dd0e1"];

const BG = "#0e0e14";
const WALL = "#2a2a35";
const EXIT = "#39d353";
const NEST = "#8e44ad"; // spawner nests
const NEST_DEAD = "#3a2d44"; // a silenced (destroyed) nest
const LABEL = "#e8e8ee";
const SELF_RING = "#ffffff";
const CORPSE_ALPHA = 0.35; // a downed player fades to this
const LABEL_PAD = 30; // extra top margin so an avatar's name doesn't pop as it scrolls off

// One colour per enemy kind; the elite reads darker and, with its larger radius, distinct.
const ENEMY_COLORS: Record<EnemyKind, string> = { grunt: "#e8643c", elite: "#a01f1f" };

// Ore reads as ground texture, not as an entity: muted enough to sit under everything drawn on
// top of it, distinct enough to spot a patch while running past.
const ORE_COLORS: Record<OreKind, string> = { metal: "#5b6472", power: "#3f7d8c" };

// M4 ships basic shapes; sprites are M5. Each buildable gets a flat fill and a lighter edge so a
// footprint reads as a placed object rather than as more ground.
const BUILD_COLORS: Record<BuildableKind, string> = {
  miner: "#c9973f",
  wall: "#6b7280",
  turret: "#4f8cff",
  generator: "#3fbfa0",
};
const BUILD_EDGE = "#1a1a22";
const GHOST_OK = "#39d353";
const GHOST_BAD = "#ff5d5d";
const GHOST_ALPHA = 0.45;

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  options: DrawOptions,
): void {
  const { arena } = world;
  const { camera, viewport } = options;

  // Clear and repaint only the visible slice of the world, not the whole 31,200² arena.
  ctx.clearRect(camera.x, camera.y, viewport.width, viewport.height);
  ctx.fillStyle = BG;
  ctx.fillRect(camera.x, camera.y, viewport.width, viewport.height);

  drawOre(ctx, world, camera, viewport);

  ctx.strokeStyle = WALL;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, arena.width - 4, arena.height - 4);

  ctx.fillStyle = EXIT;
  ctx.fillRect(world.exit.x, world.exit.y, world.exit.width, world.exit.height);

  for (const n of world.nests) {
    if (!isVisible(n.pos, n.radius, camera, viewport)) continue;
    ctx.fillStyle = n.alive ? NEST : NEST_DEAD;
    fillCircle(ctx, n.pos.x, n.pos.y, n.radius);
  }

  // Structures sit under the enemies chewing on them and over the ore they stand on.
  for (const s of world.structures) {
    const spec = BUILDABLES[s.kind];
    if (!spec) continue;
    const side = spec.footprint * TILE;
    if (!isVisible(footprintCenter(s.tile, spec.footprint), side / 2, camera, viewport)) continue;
    const x = s.tile.tx * TILE;
    const y = s.tile.ty * TILE;
    ctx.fillStyle = BUILD_COLORS[s.kind];
    ctx.fillRect(x, y, side, side);
    ctx.strokeStyle = BUILD_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, side - 2, side - 2);
  }

  for (const e of world.enemies) {
    if (!isVisible(e.pos, e.radius, camera, viewport)) continue;
    ctx.fillStyle = ENEMY_COLORS[e.kind];
    fillCircle(ctx, e.pos.x, e.pos.y, e.radius);
  }

  for (const a of world.players) {
    if (!isVisible(a.pos, a.radius, camera, viewport, LABEL_PAD)) continue;
    const dead = a.hp <= 0;
    ctx.globalAlpha = dead ? CORPSE_ALPHA : 1; // a downed player reads as a faded corpse
    ctx.fillStyle = SLOT_COLORS[(a.slot - 1) % SLOT_COLORS.length];
    fillCircle(ctx, a.pos.x, a.pos.y, a.radius);
    if (a.id === options.selfId && !dead) {
      ctx.strokeStyle = SELF_RING;
      ctx.lineWidth = 2.5;
      strokeCircle(ctx, a.pos.x, a.pos.y, a.radius + 3);
    }
    ctx.fillStyle = LABEL;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(a.name, a.pos.x, a.pos.y - a.radius - 5);
    ctx.globalAlpha = 1;
  }

  // The ghost paints last so it reads on top of whatever it would replace.
  const ghost = options.ghost;
  const ghostSpec = ghost && BUILDABLES[ghost.kind];
  if (ghost && ghostSpec) {
    const side = ghostSpec.footprint * TILE;
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.fillStyle = ghost.valid ? GHOST_OK : GHOST_BAD;
    ctx.fillRect(ghost.tile.tx * TILE, ghost.tile.ty * TILE, side, side);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ghost.valid ? GHOST_OK : GHOST_BAD;
    ctx.lineWidth = 2;
    ctx.strokeRect(ghost.tile.tx * TILE, ghost.tile.ty * TILE, side, side);
  }
}

// Paint the ore under everything else, walking only the tiles the camera can actually see. The
// arena is 2,080² tiles; the viewport is a few thousand, so this stays a fixed cost no matter
// how big the box gets. Runs of the same kind are filled as one rect to keep the draw calls down.
function drawOre(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
): void {
  const first = tileOf({ x: camera.x, y: camera.y });
  const last = tileOf({ x: camera.x + viewport.width, y: camera.y + viewport.height });
  for (let ty = Math.max(0, first.ty); ty <= last.ty; ty++) {
    let runKind: OreKind | null = null;
    let runStart = 0;
    const flush = (endTx: number) => {
      if (runKind === null) return;
      ctx.fillStyle = ORE_COLORS[runKind];
      ctx.fillRect(runStart * TILE, ty * TILE, (endTx - runStart) * TILE, TILE);
      runKind = null;
    };
    for (let tx = Math.max(0, first.tx); tx <= last.tx; tx++) {
      const kind = oreAt(world.ore, { tx, ty });
      if (kind === runKind) continue;
      flush(tx);
      if (kind !== null) {
        runKind = kind;
        runStart = tx;
      }
    }
    flush(last.tx + 1);
  }
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function strokeCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
