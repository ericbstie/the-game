import type { PlayerId, WorldSnapshot } from "../lobby/protocol";

// Pure canvas rendering: turn a WorldSnapshot into 2D draw calls. No React, no DOM
// lookups, no state — so it renders identically in the browser and under a spy context
// in tests. M2 is basic shapes only; sprites are Milestone 5.

export interface DrawOptions {
  selfId?: PlayerId; // ringed so you can find yourself
}

// One stable colour per slot (1..6), so a player keeps their colour across the match.
const SLOT_COLORS = ["#4f8cff", "#ff5d5d", "#40c463", "#f2c14e", "#c77dff", "#4dd0e1"];

const BG = "#0e0e14";
const WALL = "#2a2a35";
const EXIT = "#39d353";
const MONSTER = "#c0392b";
const LABEL = "#e8e8ee";
const SELF_RING = "#ffffff";

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  options: DrawOptions = {},
): void {
  const { arena } = world;

  ctx.clearRect(0, 0, arena.width, arena.height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, arena.width, arena.height);

  ctx.strokeStyle = WALL;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, arena.width - 4, arena.height - 4);

  ctx.fillStyle = EXIT;
  ctx.fillRect(world.exit.x, world.exit.y, world.exit.width, world.exit.height);

  ctx.fillStyle = MONSTER;
  for (const m of world.monsters) fillCircle(ctx, m.pos.x, m.pos.y, m.radius);

  for (const a of world.players) {
    ctx.fillStyle = SLOT_COLORS[(a.slot - 1) % SLOT_COLORS.length];
    fillCircle(ctx, a.pos.x, a.pos.y, a.radius);
    if (a.id === options.selfId) {
      ctx.strokeStyle = SELF_RING;
      ctx.lineWidth = 2.5;
      strokeCircle(ctx, a.pos.x, a.pos.y, a.radius + 3);
    }
    ctx.fillStyle = LABEL;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(a.name, a.pos.x, a.pos.y - a.radius - 5);
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
