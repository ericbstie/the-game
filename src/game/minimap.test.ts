import { describe, expect, test } from "bun:test";
import type { Arena, Vec2 } from "../lobby/protocol";
import { generateOre, type OreGrid, TILE, tileKey } from "./build";
import type { Camera, Viewport } from "./camera";
import {
  MINIMAP_COVERAGE_U,
  MINIMAP_MARGIN,
  MINIMAP_ORE_CELL_U,
  MINIMAP_SIZE,
  minimapWindow,
  oreCells,
  oreDensity,
  project,
  projectRect,
} from "./minimap";

const arena: Arena = { width: 31_200, height: 31_200 };
const camera: Camera = { x: 1_000, y: 2_000 };
const viewport: Viewport = { width: 800, height: 600 };
const centre: Vec2 = { x: 15_600, y: 15_600 };
const win = () => minimapWindow(centre, camera, viewport, MINIMAP_COVERAGE_U);

describe("the minimap window", () => {
  test("opens at 1×, covering 7,800 u centred on the player", () => {
    expect(MINIMAP_COVERAGE_U).toBe(7_800);
    const w = win();
    expect(w.coverage).toBe(7_800);
    expect(w.worldX).toBe(centre.x - 3_900);
    expect(w.worldY).toBe(centre.y - 3_900);
  });

  test("sits in the viewport's top-right corner, in the world coordinates drawWorld paints in", () => {
    const w = win();
    expect(w.x).toBe(camera.x + viewport.width - MINIMAP_MARGIN - MINIMAP_SIZE);
    expect(w.y).toBe(camera.y + MINIMAP_MARGIN);
    expect(w.size).toBe(MINIMAP_SIZE);
  });

  test("stays centred on the player against a wall — the window is not clamped to the arena", () => {
    const corner = minimapWindow({ x: 100, y: 100 }, camera, viewport, MINIMAP_COVERAGE_U);
    expect(corner.worldX).toBe(100 - 3_900);
    expect(corner.worldY).toBe(100 - 3_900);
    expect(project(corner, { x: 100, y: 100 })).toEqual({
      x: corner.x + MINIMAP_SIZE / 2,
      y: corner.y + MINIMAP_SIZE / 2,
    });
  });
});

describe("the minimap projection", () => {
  test("maps the window onto the map bounds exactly", () => {
    const w = win();
    expect(project(w, centre)).toEqual({ x: w.x + w.size / 2, y: w.y + w.size / 2 });
    expect(project(w, { x: w.worldX, y: w.worldY })).toEqual({ x: w.x, y: w.y });
    const far = { x: w.worldX + w.coverage, y: w.worldY + w.coverage };
    expect(project(w, far)).toEqual({ x: w.x + w.size, y: w.y + w.size });
  });

  test("holds at several viewport sizes: the window always spans the whole plate", () => {
    for (const v of [
      { width: 320, height: 480 },
      { width: 800, height: 600 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      const w = minimapWindow(centre, camera, v, MINIMAP_COVERAGE_U);
      expect(w.x).toBe(camera.x + v.width - MINIMAP_MARGIN - MINIMAP_SIZE);
      expect(w.scale).toBeCloseTo(MINIMAP_SIZE / MINIMAP_COVERAGE_U, 10);
      expect(project(w, centre)).toEqual({ x: w.x + w.size / 2, y: w.y + w.size / 2 });
      expect(project(w, { x: w.worldX, y: w.worldY })).toEqual({ x: w.x, y: w.y });
    }
  });

  test("scales with the coverage it is given, so a wider window is the same plate", () => {
    for (const coverage of [2_600, 7_800, 15_600]) {
      const w = minimapWindow(centre, camera, viewport, coverage);
      expect(w.size).toBe(MINIMAP_SIZE);
      expect(w.worldX).toBe(centre.x - coverage / 2);
      expect(project(w, { x: centre.x + coverage / 2, y: centre.y })).toEqual({
        x: w.x + w.size,
        y: w.y + w.size / 2,
      });
    }
  });

  test("answers null outside the window rather than clamping to the map edge", () => {
    const w = win();
    const outside: Vec2[] = [
      { x: w.worldX - 1, y: centre.y },
      { x: w.worldX + w.coverage + 1, y: centre.y },
      { x: centre.x, y: w.worldY - 1 },
      { x: centre.x, y: w.worldY + w.coverage + 1 },
      { x: centre.x + 14_352, y: centre.y }, // a revealed door on the far wall
    ];
    for (const pos of outside) expect(project(w, pos)).toBeNull();
  });
});

describe("projecting a rect", () => {
  const exit = { x: 0, y: 15_400, width: 98, height: 936 };

  test("maps a rect inside the window to its scaled place on the plate", () => {
    const near = minimapWindow({ x: 1_500, y: 15_600 }, camera, viewport, MINIMAP_COVERAGE_U);
    const box = projectRect(near, exit);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.width).toBeCloseTo(exit.width * near.scale, 10);
    expect(box.height).toBeCloseTo(exit.height * near.scale, 10);
    expect(box.x).toBeGreaterThanOrEqual(near.x);
    expect(box.y + box.height).toBeLessThanOrEqual(near.y + near.size);
  });

  test("clips a rect straddling the window's edge to the plate", () => {
    const w = win();
    const straddling = { x: w.worldX - 500, y: centre.y, width: 1_000, height: 100 };
    const box = projectRect(w, straddling);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.x).toBeCloseTo(w.x, 10);
    expect(box.width).toBeCloseTo(500 * w.scale, 10);
  });

  test("answers null for a rect wholly outside — absent, never pinned to the edge", () => {
    const w = win();
    expect(projectRect(w, exit)).toBeNull();
  });
});

describe("the ore density field", () => {
  const grid: OreGrid = new Map();
  const cellTiles = MINIMAP_ORE_CELL_U / TILE;
  for (let i = 0; i < 10; i++) grid.set(tileKey({ tx: i, ty: 0 }), "metal");
  grid.set(tileKey({ tx: cellTiles, ty: cellTiles }), "power");

  test("counts ore tiles into world-anchored cells, both kinds as one field", () => {
    const field = oreDensity(grid, arena);
    expect(field.cellU).toBe(MINIMAP_ORE_CELL_U);
    expect(field.perCell).toBe(cellTiles * cellTiles);
    expect(field.cols).toBe(Math.ceil(arena.width / MINIMAP_ORE_CELL_U));
    // Ten tiles in a row straddle the lattice: eight fall in the first cell and two in the next.
    expect(field.cells[0]).toBe(cellTiles);
    expect(field.cells[1]).toBe(10 - cellTiles);
    expect(field.cells[1 * field.cols + 1]).toBe(1);
  });

  test("is derived once per grid, not once per frame", () => {
    expect(oreDensity(grid, arena)).toBe(oreDensity(grid, arena));
    expect(oreDensity(new Map(grid), arena)).not.toBe(oreDensity(grid, arena));
  });

  test("holds the whole arena's ore, so the field never moves with the window", () => {
    const real = generateOre(arena, 4_242);
    const field = oreDensity(real, arena);
    let counted = 0;
    for (const cell of field.cells) counted += cell;
    expect(counted).toBe(real.size);
  });
});

describe("the ore cells a window covers", () => {
  const real = generateOre(arena, 4_242);

  test("yields only cells carrying ore, each a square on the plate", () => {
    const w = minimapWindow({ x: 22_000, y: 15_600 }, camera, viewport, MINIMAP_COVERAGE_U);
    const cells = oreCells(w, oreDensity(real, arena));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.density).toBeGreaterThan(0);
      expect(cell.density).toBeLessThanOrEqual(1);
      expect(cell.size).toBeCloseTo(MINIMAP_ORE_CELL_U * w.scale, 10);
      expect(cell.x + cell.size).toBeGreaterThan(w.x);
      expect(cell.x).toBeLessThan(w.x + w.size);
    }
  });

  test("is anchored to the world, so the texture does not crawl as the player walks", () => {
    const field = oreDensity(real, arena);
    // Every cell sits on the world lattice, whatever fraction of a cell the player stands into it.
    for (const centreX of [22_000, 22_037, 22_119]) {
      const w = minimapWindow({ x: centreX, y: 15_600 }, camera, viewport, MINIMAP_COVERAGE_U);
      for (const cell of oreCells(w, field)) {
        const worldX = w.worldX + (cell.x - w.x) / w.scale;
        const worldY = w.worldY + (cell.y - w.y) / w.scale;
        expect(worldX / MINIMAP_ORE_CELL_U).toBeCloseTo(Math.round(worldX / MINIMAP_ORE_CELL_U), 6);
        expect(worldY / MINIMAP_ORE_CELL_U).toBeCloseTo(Math.round(worldY / MINIMAP_ORE_CELL_U), 6);
      }
    }
  });

  test("aggregates rather than drawing tiles: a 7,800 u window is never per-tile", () => {
    const w = minimapWindow({ x: 22_000, y: 15_600 }, camera, viewport, MINIMAP_COVERAGE_U);
    const cells = oreCells(w, oreDensity(real, arena));
    const tilesAcross = MINIMAP_COVERAGE_U / TILE;
    expect(cells.length).toBeLessThan(tilesAcross);
  });
});
