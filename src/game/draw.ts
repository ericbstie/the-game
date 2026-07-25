import type {
  Avatar,
  BuildableKind,
  EnemyKind,
  OreKind,
  PlayerId,
  RenderedEnemy,
  RenderedNest,
  Tile,
  WorldSnapshot,
} from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import { BUILDABLES, footprintCenter, oreAt, TILE, tileOf } from "./build";
import { type Camera, isVisible, type Viewport } from "./camera";

// Pure canvas rendering: turn a WorldSnapshot into 2D draw calls in WORLD coordinates. The
// caller pre-translates the context to the camera (so 1 world unit = 1 CSS px), so this
// draws in world space and never sees the camera transform. Off-screen entities are culled
// and the clear/fill is bounded to the viewport, keeping cost independent of world size. No
// React, no DOM, no state — it renders identically in the browser and under a spy context.
//
// Milestone 5 turns the shapes into sprites. Two things about the world changed with them:
//
// - **Things stand up, so the order they paint in is their Y.** One sorted pass replaces the
//   fixed category order (ore, nests, structures, enemies, players), because whatever is lower on
//   screen has to paint in front of whatever is behind it. The floor, the ore and the flat
//   generator are not part of that — they lie down, and everything else stands on them.
// - **An upright sprite is anchored at its feet.** It occupies a point on the floor and extends
//   *above* it, so its box is not centred on its position the way a circle was, and the camera
//   cull has to allow for a body that reaches a whole sprite-height past its own feet.
//
// Sprites arrive one at a time, one agent each (ADR 0002). A sprite the registry has no module
// for yet resolves to null and that entity keeps the shape it has drawn since M2, so the game
// stays playable and this file's older tests stay honest throughout.

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
  // Baked art, or nothing. Absent — in a test, or before the first sprite lands — every entity
  // falls back to its shape, which is what keeps this one draw path the only one.
  sprites?: SpriteSource;
  // Device pixels per CSS pixel, matching the `setTransform(dpr, …)` the caller paints through.
  // Blits are aligned to whole device pixels with it; nothing else here needs it.
  dpr?: number;
}

// One thing standing on the floor, waiting for its turn to paint. `y` is its floor line — the
// point it touches the ground, which is what the whole order sorts on.
interface Standing {
  y: number;
  paint: () => void;
}

// Only the generator is drawn flat, from above (#76 §2). Everything else built stands up in
// elevation and joins the sorted pass.
const FLAT: Partial<Record<BuildableKind, true>> = { generator: true };

// Which way a character faces and where it is in its walk cycle are #73's to derive from the
// position stream. Until that lands every character stands still and faces east. The indices
// already flow through the cache and the blit, so #73 is a change to these two arguments.
const FACING_PENDING = 0;
const FRAME_PENDING = 0;

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
  const { camera, viewport, sprites, dpr = 1 } = options;

  // A sprite is baked at `size × dpr` and blitted into a `size`-CSS-px box, so every blit is one
  // device pixel per baked pixel with nothing to resample (#77 §5). Smoothing could then only
  // soften a sprite that had drifted off that alignment — exactly the case that should be visible
  // rather than quietly blurred. Set per frame, not once: `GameScreen` resizes the backing store
  // when the DPR changes, and assigning `canvas.width` resets the whole 2D drawing state with it.
  ctx.imageSmoothingEnabled = false;

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

  // An upright sprite occupies a point on the floor and extends above it, so its box hangs off
  // the bottom centre. Aligning that to whole device pixels is what keeps a bake that was made
  // for this exact resolution from being resampled by a fractional world position.
  const blit = (sprite: BakedSprite, footX: number, footY: number): void => {
    ctx.drawImage(
      sprite.image,
      snap(footX - sprite.size / 2, camera.x, dpr),
      snap(footY - sprite.size, camera.y, dpr),
      sprite.size,
      sprite.size,
    );
  };

  const standing: Standing[] = [];

  for (const n of world.nests) {
    if (!isVisible(n.pos, n.radius * 2, camera, viewport)) continue;
    standing.push({ y: n.pos.y, paint: () => paintNest(ctx, n, sprites, blit) });
  }

  for (const s of world.structures) {
    const spec = BUILDABLES[s.kind];
    if (!spec) continue;
    const side = spec.footprint * TILE;
    if (!isVisible(footprintCenter(s.tile, spec.footprint), side / 2, camera, viewport)) continue;
    // A building's box *is* its footprint, so its floor line is the front edge of that square.
    const paint = () => paintStructure(ctx, s.kind, s.tile, side, sprites, blit);
    if (FLAT[s.kind]) paint();
    else standing.push({ y: (s.tile.ty + spec.footprint) * TILE, paint });
  }

  for (const e of world.enemies) {
    if (!isVisible(e.pos, e.radius * 2, camera, viewport)) continue;
    standing.push({ y: e.pos.y, paint: () => paintEnemy(ctx, e, sprites, blit) });
  }

  for (const a of world.players) {
    if (!isVisible(a.pos, a.radius * 2, camera, viewport, LABEL_PAD)) continue;
    standing.push({
      y: a.pos.y,
      paint: () => paintAvatar(ctx, a, a.id === options.selfId, sprites, blit),
    });
  }

  // Lower on screen paints later, so it paints in front. The sort is stable (ES2019), so two
  // things sharing a floor line keep collection order and every client resolves the tie the same
  // way. At ~250 standing entities this whole pass — collect, sort and dispatch — costs ~0.04 ms.
  standing.sort((a, b) => a.y - b.y);
  for (const entry of standing) entry.paint();

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

// Put a baked sprite on the floor at a world point. Closed over the camera and the DPR by
// `drawWorld`, so the painters below never have to think about either.
type Blit = (sprite: BakedSprite, footX: number, footY: number) => void;

function paintNest(
  ctx: CanvasRenderingContext2D,
  nest: RenderedNest,
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  // One egg-sac sprite carries both states as variants of its facing axis: 0 intact, 1 destroyed.
  const sprite = sprites?.("nest", nest.alive ? 0 : 1, 0);
  if (sprite) {
    blit(sprite, nest.pos.x, nest.pos.y);
    return;
  }
  ctx.fillStyle = nest.alive ? NEST : NEST_DEAD;
  fillCircle(ctx, nest.pos.x, nest.pos.y, nest.radius);
}

function paintStructure(
  ctx: CanvasRenderingContext2D,
  kind: BuildableKind,
  tile: Tile,
  side: number,
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  const sprite = sprites?.(kind, 0, 0);
  if (sprite) {
    blit(sprite, tile.tx * TILE + side / 2, tile.ty * TILE + side);
    return;
  }
  const x = tile.tx * TILE;
  const y = tile.ty * TILE;
  ctx.fillStyle = BUILD_COLORS[kind];
  ctx.fillRect(x, y, side, side);
  ctx.strokeStyle = BUILD_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, side - 2, side - 2);
}

function paintEnemy(
  ctx: CanvasRenderingContext2D,
  enemy: RenderedEnemy,
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  const sprite = sprites?.(enemy.kind, FACING_PENDING, FRAME_PENDING);
  if (sprite) {
    blit(sprite, enemy.pos.x, enemy.pos.y);
    return;
  }
  ctx.fillStyle = ENEMY_COLORS[enemy.kind];
  fillCircle(ctx, enemy.pos.x, enemy.pos.y, enemy.radius);
}

function paintAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: Avatar,
  isSelf: boolean,
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  const dead = avatar.hp <= 0;
  ctx.globalAlpha = dead ? CORPSE_ALPHA : 1; // a downed player reads as a faded corpse
  const sprite = sprites?.("player", FACING_PENDING, FRAME_PENDING);
  if (sprite) blit(sprite, avatar.pos.x, avatar.pos.y);
  else {
    ctx.fillStyle = SLOT_COLORS[(avatar.slot - 1) % SLOT_COLORS.length];
    fillCircle(ctx, avatar.pos.x, avatar.pos.y, avatar.radius);
  }
  if (isSelf && !dead) {
    ctx.strokeStyle = SELF_RING;
    ctx.lineWidth = 2.5;
    strokeCircle(ctx, avatar.pos.x, avatar.pos.y, avatar.radius + 3);
  }
  // The label rides above whatever was actually drawn, which a foot-anchored sprite makes taller
  // than the circle it replaced.
  const top = avatar.pos.y - (sprite ? sprite.size : avatar.radius);
  ctx.fillStyle = LABEL;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(avatar.name, avatar.pos.x, top - 5);
  ctx.globalAlpha = 1;
}

// Land a world coordinate on a whole device pixel. The caller paints through
// `setTransform(dpr, 0, 0, dpr, -camera * dpr, …)`, so `(world - camera) * dpr` is the device
// pixel a coordinate falls on, and rounding it there is what keeps a bake 1:1 with the display.
function snap(world: number, cameraAxis: number, dpr: number): number {
  return cameraAxis + Math.round((world - cameraAxis) * dpr) / dpr;
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
