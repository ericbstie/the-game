---
name: canvas-sprite-generation
description: >-
  Generate 2D sprites that draw straight onto an HTML5 canvas for a single-file
  browser game. Auto-invoke when creating, drawing, or animating sprites, sprite
  sheets, or entity art (player, grunts, elites, nests, miners, walls, turrets,
  mines, clusters, the door) for a canvas game, or when handling pixel-crisp
  rendering, sprite caching, atlases, or color variants. Produces procedural
  sprites in code — no external image assets required.
---

# 2D Canvas Sprite Generation

This project is a single-file HTML/JS canvas game with no build step and no
asset pipeline. Generate sprites **in code**: draw each once to an offscreen
canvas, cache it, and blit the cache every frame. No PNGs to load, no network,
nothing to lose.

## Core pattern — bake once, blit many

Drawing vector paths every frame is slow. Draw each sprite once to an offscreen
canvas and reuse it:

```js
function makeSprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  return c; // a canvas is a valid drawImage() source
}

const grunt = makeSprite(16, 16, (g) => {
  g.fillStyle = '#c0392b';
  g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#000';
  g.fillRect(5, 6, 2, 2); g.fillRect(9, 6, 2, 2); // eyes
});

// each frame:
ctx.drawImage(grunt, x - 8, y - 8);
```

## Pixel art from a string grid

For readable, editable pixel sprites, define art as rows of characters mapped to
a palette. Easy to tweak, diff-friendly, no tooling.

```js
function pixelSprite(rows, palette, scale = 1) {
  const h = rows.length, w = rows[0].length;
  return makeSprite(w * scale, h * scale, (g) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const col = palette[rows[y][x]];
        if (!col) continue;         // any unmapped char (e.g. space) = transparent
        g.fillStyle = col;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
  });
}

const door = pixelSprite([
  '.####.',
  '#....#',
  '#.oo.#',
  '#.oo.#',
  '#....#',
], { '#': '#8d6e63', '.': '#5d4037', 'o': '#ffd54f' }, 4);
```

## Crisp rendering (set once)

- Turn off smoothing so scaled pixel art stays sharp, not blurry: `ctx.imageSmoothingEnabled = false;` — set it again after any context reset.
- Draw sprites at integer pixel positions (`Math.round(x)`); sub-pixel blits reintroduce blur.
- For HiDPI, scale the backing store by `devicePixelRatio` and keep the CSS size fixed, so sprites stay sharp on retina without changing game coordinates.

## Rotation and flips — cache the variants too

Rotating inside `drawImage` every frame costs. If a sprite faces only 8
directions, bake all 8:

```js
function bakeRotations(src, steps = 8) {
  const s = Math.ceil(Math.max(src.width, src.height) * 1.5);
  return Array.from({ length: steps }, (_, i) =>
    makeSprite(s, s, (g) => {
      g.translate(s / 2, s / 2);
      g.rotate((i / steps) * Math.PI * 2);
      g.drawImage(src, -src.width / 2, -src.height / 2);
    }));
}
```

Flip horizontally once into a cached canvas with `g.scale(-1, 1)` rather than
per frame.

## Color variants — one sprite, many teams

Draw the base in a neutral key color and recolor for variants (grunt vs elite,
player teams) instead of authoring each by hand: bake the shape, then either
re-run `pixelSprite` with a different palette, or set `globalCompositeOperation =
'source-in'` and fill a tint over the baked alpha.

## Sprite atlas (optional)

If you prefer one sheet, bake all sprites into a single canvas at known cells and
blit by rect: `drawImage(atlas, col*S, row*S, S, S, dx, dy, S, S)`. Keep a small
`{ name: [col, row] }` map so lookups read by name, not magic numbers.

## For this game specifically

Generate one baked sprite per entity type and reuse across all instances — there
may be hundreds of grunts on screen, but only one grunt canvas:

- **Player / squad** — recolor one base sprite per player so teammates are told apart at a glance.
- **Grunt vs elite** — same silhouette, elite larger and a hotter palette; readability over detail (the design calls for readable enemies).
- **Nest** — a distinct, larger structure; pulse it on the ~30s wave beat by blitting a cached "charging" frame rather than redrawing.
- **Miner / wall / turret / mine** — simple geometric bakes; a turret can be a base sprite plus a separately-baked, rotatable barrel.
- **Clusters (scrap / energy)** — two palettes of the same rock shape; density, not unique art, sells the field.

Keep sprites small (8–24px) and let scale do the rest — it's faster, and it
matches the game's readable, watchable look.
