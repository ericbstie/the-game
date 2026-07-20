import type { EnemyKind, PlayerId, WorldSnapshot } from "../lobby/protocol";
import { type Camera, isVisible, type Viewport } from "./camera";

// Pure canvas rendering: turn a WorldSnapshot into 2D draw calls in WORLD coordinates. The
// caller pre-translates the context to the camera (so 1 world unit = 1 CSS px), so this
// draws in world space and never sees the camera transform. Off-screen entities are culled
// and the clear/fill is bounded to the viewport, keeping cost independent of world size. No
// React, no DOM, no state — it renders identically in the browser and under a spy context.
// M2 is basic shapes only; sprites are Milestone 5.

export interface DrawOptions {
  camera: Camera;
  viewport: Viewport;
  selfId?: PlayerId; // ringed so you can find yourself
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
