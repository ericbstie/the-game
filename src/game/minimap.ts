import type { Arena, Vec2 } from "../lobby/protocol";
import { type OreGrid, TILE, tileFromKey } from "./build";
import type { Camera, Viewport } from "./camera";

// Everything the corner map decides before any ink is spent (#93): where the plate sits, what
// slice of the arena it shows, where a world point lands on it — and nothing about how any of it
// is drawn. Pure geometry, like `camera.ts` and `edgeMarker.ts` and for the same reason: a
// projection is checkable without a canvas, and this one has to be checked at every viewport size
// and every device ratio the game runs at.
//
// The seam is here rather than in `draw.ts` because both of the changes already chartered land on
// this side of it. #110 adds 0.5× and 3× coverage levels — one more argument to `minimapWindow`,
// which already takes coverage as a parameter for exactly that reason. #111 replaces eight nests
// on a ring with fifty at random; the map asks a nest only where it is and whether it is alive, so
// that layer is a loop over `world.nests` with no count and no ring geometry anywhere in it.

// What the map shows across, in world units. **The opening level, not the only one** — #110 adds
// 0.5× (15,600 u) and 3× (2,600 u) beside this and cycles between them, which is why coverage is a
// parameter of the window below and not read from here.
export const MINIMAP_COVERAGE_U = 7_800;

// The plate's side in CSS px, and how far it is held off the viewport corner. At 7,800 u across a
// 200 px plate the scale is 1:39, so a 15 u tile is 0.38 px — under a pixel, which is what makes
// every layer here an aggregate or a fixed-size marker rather than a drawing of the world.
export const MINIMAP_SIZE = 200;
export const MINIMAP_MARGIN = 16;

// How coarsely the ore is counted: one cell per 8 × 8 tiles. The field is 0.19% of the arena by
// area and lies in patches of 30–80 tiles of metal and 10–20 of power (`build.ts`), so this is the
// largest cell that still leaves a metal patch spread over several of them — coarser and metal
// collapses to one mark too, the way a power patch already does at any size worth walking. Finer
// and the walk grows without the texture reading any better. At 1× a cell is 3.1 px on the plate.
export const MINIMAP_ORE_CELL_U = 8 * TILE;

// Where the map is and what it looks at. World coordinates throughout, because `drawWorld` paints
// through the camera transform and never un-does it — a corner of the *screen* is therefore a
// point in the world, offset by the camera, exactly as the downed-player dim already treats it.
export interface MinimapWindow {
  // The plate.
  x: number;
  y: number;
  size: number;
  // The square of the world it shows, and the ratio between the two.
  worldX: number;
  worldY: number;
  coverage: number;
  scale: number; // plate px per world unit
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A slice of the arena centred on the player, in the viewport's top-right corner — the one corner
// the HUD leaves free (`styles.css`: signals top-left, health bottom-left, the build bar bottom
// centre, the banks bottom-right).
//
// Deliberately **not** clamped to the arena the way `computeCamera` is. The camera clamps so a
// player in a corner sees the wall instead of black; the map has no black to show, and a window
// that slid off the player would stop answering the one question it is for — where am I, and what
// is around me.
export function minimapWindow(
  centre: Vec2,
  camera: Camera,
  viewport: Viewport,
  coverage: number,
): MinimapWindow {
  return {
    x: camera.x + viewport.width - MINIMAP_MARGIN - MINIMAP_SIZE,
    y: camera.y + MINIMAP_MARGIN,
    size: MINIMAP_SIZE,
    worldX: centre.x - coverage / 2,
    worldY: centre.y - coverage / 2,
    coverage,
    scale: MINIMAP_SIZE / coverage,
  };
}

// Where a world point lands on the plate, or **null when it is outside the window**.
//
// Null and not an edge point. This is the opposite of #94's off-screen arrows, which pin a
// teammate to the rim of the viewport so you can still be pointed at them: a window onto part of
// the arena that also marked everything beyond it would be claiming coverage it does not have, and
// the first thing it would lie about is the door — revealed 14,352 u away and drawn on the map rim
// as though the squad were standing next to it.
export function project(win: MinimapWindow, pos: Vec2): Vec2 | null {
  const dx = pos.x - win.worldX;
  const dy = pos.y - win.worldY;
  if (dx < 0 || dy < 0 || dx > win.coverage || dy > win.coverage) return null;
  return { x: win.x + dx * win.scale, y: win.y + dy * win.scale };
}

// The same for a rectangle — the door, which is a bar set into a perimeter wall rather than a
// point. Clipped to the window, so a door the squad is standing beside draws the part of it the
// window reaches and no more, and null when the two do not meet at all.
export function projectRect(win: MinimapWindow, rect: WorldRect): WorldRect | null {
  const left = Math.max(rect.x, win.worldX);
  const top = Math.max(rect.y, win.worldY);
  const right = Math.min(rect.x + rect.width, win.worldX + win.coverage);
  const bottom = Math.min(rect.y + rect.height, win.worldY + win.coverage);
  if (right <= left || bottom <= top) return null;
  return {
    x: win.x + (left - win.worldX) * win.scale,
    y: win.y + (top - win.worldY) * win.scale,
    width: (right - left) * win.scale,
    height: (bottom - top) * win.scale,
  };
}

// How much ore each cell of the arena holds. Whole-arena and world-anchored, which is what stops
// the texture crawling under the player as they walk: a cell is a fixed square of ground, not a
// square of plate.
export interface OreDensity {
  cells: Uint16Array; // ore tiles in each cell, row-major
  cols: number;
  rows: number;
  cellU: number;
  perCell: number; // tiles in a full cell, so a count reads as a fraction
}

// One field per ore grid, derived on the frame it is first asked for and never again.
//
// A `WeakMap` rather than a `let`, so the field goes when the match that owns the grid does. That
// is the eviction policy the grass mechanism was chosen partly for *not* needing — but here the
// key is one object per match rather than a chunk per 2,080² tiles, so there is nothing to evict
// and nothing to bound.
const FIELDS = new WeakMap<OreGrid, { arena: Arena; field: OreDensity }>();

// Bucket the whole arena's ore into cells, once.
//
// Measured against the alternative — walk the sparse grid and bucket it fresh every frame — on the
// real generated field: **156 µs a frame against 2 µs**, because the grid holds ~8,400 tiles while
// the window covers ~4,400 cells of which ~14–45 carry anything. The field never changes after
// world gen, so per-frame bucketing is 156 µs of the same answer, every frame, for the whole match.
// That is `docs/frame-budget.md` rule 6 with a different noun: a derivation is billed once and a
// composite is billed per frame, and the two are not close.
export function oreDensity(ore: OreGrid, arena: Arena): OreDensity {
  const held = FIELDS.get(ore);
  if (held && held.arena.width === arena.width && held.arena.height === arena.height) {
    return held.field;
  }
  const cellTiles = MINIMAP_ORE_CELL_U / TILE;
  const cols = Math.ceil(arena.width / MINIMAP_ORE_CELL_U);
  const rows = Math.ceil(arena.height / MINIMAP_ORE_CELL_U);
  const cells = new Uint16Array(cols * rows);
  // Both kinds counted into one number. #93 asks for ore as density and says nothing about which
  // sort it is; a map that told metal from power would be answering a question nobody asked.
  for (const key of ore.keys()) {
    const { tx, ty } = tileFromKey(key);
    cells[Math.floor(ty / cellTiles) * cols + Math.floor(tx / cellTiles)]++;
  }
  const field: OreDensity = {
    cells,
    cols,
    rows,
    cellU: MINIMAP_ORE_CELL_U,
    perCell: cellTiles ** 2,
  };
  FIELDS.set(ore, { arena, field });
  return field;
}

// One cell of the ore field as it falls on the plate. `density` is the share of the cell that is
// ore, which is the whole of what this layer has to say.
export interface OreCell {
  x: number;
  y: number;
  size: number;
  density: number;
}

// The cells of the field the window reaches, empty ones dropped. The walk is bounded to the window
// rather than to the arena, so this costs what the map covers and not what the world holds — the
// same property every floor pass in `draw.ts` has.
export function oreCells(win: MinimapWindow, field: OreDensity): OreCell[] {
  const size = field.cellU * win.scale;
  const firstCol = Math.floor(win.worldX / field.cellU);
  const firstRow = Math.floor(win.worldY / field.cellU);
  // A window that does not land on the lattice straddles one extra cell on each axis.
  const across = Math.ceil(win.coverage / field.cellU) + 1;
  const cells: OreCell[] = [];
  for (let row = Math.max(0, firstRow); row < Math.min(field.rows, firstRow + across); row++) {
    for (let col = Math.max(0, firstCol); col < Math.min(field.cols, firstCol + across); col++) {
      const count = field.cells[row * field.cols + col];
      if (count === 0) continue;
      cells.push({
        x: win.x + (col * field.cellU - win.worldX) * win.scale,
        y: win.y + (row * field.cellU - win.worldY) * win.scale,
        size,
        density: count / field.perCell,
      });
    }
  }
  return cells;
}
