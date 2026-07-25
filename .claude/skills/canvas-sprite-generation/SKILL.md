---
name: canvas-sprite-generation
description: >-
  Generate 2D sprites that draw straight onto an HTML5 canvas for a browser
  game. Auto-invoke when creating, drawing, or animating sprites, sprite
  sheets, or entity art (player, grunts, elites, nests, miners, walls, turrets,
  generators, ore, the door) for a canvas game, or when handling pixel-crisp
  rendering, sprite caching, atlases, or color variants. Produces procedural
  sprites in code — no external image assets required.
---

# 2D Canvas Sprite Generation

This project is a React + Bun browser game rendered on an HTML5 canvas, with no
art-asset pipeline. Generate sprites **in code**: draw each once to an offscreen
canvas, cache it, and blit the cache every frame. No PNGs to load, no network,
nothing to lose.

Every sprite goes through the loop in [`docs/sprite-loop.md`](../../../docs/sprite-loop.md) —
write it, render a review sheet, have a subagent look at the sheet. Read that first.

## Core pattern — bake once at device scale, blit many

Drawing vector paths every frame is slow. Draw each sprite once to an offscreen
canvas and reuse it — **at `size × dpr`**, for the reason in *HiDPI* below:

```js
function makeSprite(w, h, dpr, draw) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);      // draw in logical units, rasterise at device resolution
  draw(g, w, h);
  return c;               // a canvas is a valid drawImage() source
}

const grunt = makeSprite(16, 16, devicePixelRatio, (g, w, h) => {
  g.fillStyle = '#000';
  g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
});

// each frame — blit into a 16-CSS-px box, whatever resolution it was baked at:
ctx.drawImage(grunt, Math.round(x - 8), Math.round(y - 8), 16, 16);
```

## Pixel art from a string grid

For readable, editable pixel sprites, define art as rows of characters mapped to
a palette. Easy to tweak, diff-friendly, no tooling.

```js
function pixelSprite(rows, palette, scale = 1, dpr = devicePixelRatio) {
  const h = rows.length, w = rows[0].length;
  return makeSprite(w * scale, h * scale, dpr, (g) => {
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

## HiDPI — two scalings, and the bake is the one people miss

Scaling the **backing store** is necessary and not sufficient. There are two:

1. **The backing store.** Size the canvas to `cssSize × devicePixelRatio` and keep the CSS size
   fixed, so game coordinates don't move.
2. **The bake.** The render loop then paints through `ctx.setTransform(dpr, 0, 0, dpr, …)`, so a
   sprite baked at its *logical* size is **upscaled by that transform** before it reaches the
   screen. At the sizes this game ships — a 28 px player, a 32 px grunt — that is the difference
   between hard black ink and a smudge: measured, ~70% of a 28 px contour baked at 1× comes out
   grey, against 44% baked at device scale.

So **bake at `size × dpr` and blit into a `size`-CSS-px box**, as in the pattern above. The sprite
cache is keyed by dpr as well as by kind, facing and frame, and re-bakes when dpr changes — which
the render loop already detects.

**Do not try to "fix" the grey.** Thresholding to hard black shatters the curves; per-pixel
`putImageData` goes visibly polygonal; `getContext('2d', { antialias: false })` is silently ignored
and the Chromium canvas-AA flags are no-ops. Anti-aliasing is not the problem — resolution is.
Details and measurements: [`docs/sprite-loop.md`](../../../docs/sprite-loop.md).

## Crisp rendering (set once)

- Draw sprites at integer pixel positions (`Math.round(x)`); sub-pixel blits reintroduce blur.
- **Axis-aligned fills on integer edges carry no anti-aliasing at all** — walls, elevation faces and
  the build ghost stay hard-edged for free, with no trickery.
- `ctx.imageSmoothingEnabled = false` is for **magnifying** an already-baked sprite, such as the
  review sheet's artefact panel, where it makes real pixels visible. It is *not* a fix for a soft
  bake — on an under-resolved sprite it produces jagged instead of soft. Set it again after any
  context reset.

## Rotation and flips — cache the variants too

Rotating inside `drawImage` every frame costs. Bake the variants instead. Note that `src` is
already at device resolution, so the rotation bakes at `dpr` 1 — and that a **character's** 8
facings are *drawn*, not rotated: a figure seen from behind is not a rotation of one seen from the
front. Rotation is for parts that really do turn, like a turret barrel.

```js
function bakeRotations(src, steps = 8) {
  const s = Math.ceil(Math.max(src.width, src.height) * 1.5); // device px: src is already baked
  return Array.from({ length: steps }, (_, i) =>
    makeSprite(s, s, 1, (g) => {
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
- **Miner / wall / turret / generator** — simple geometric bakes on a 15-unit tile grid (2×2 tiles each, 5×5 for the generator); a turret can be a base sprite plus a separately-baked, rotatable barrel. There is no landmine.
- **Ore (metal / power)** — ground texture, not entities: two palettes of the same tile, filling whole patches. Density, not unique art, sells the field — and a full screen of it can't be culled, so bake it in bulk rather than per tile.

Keep sprites small (8–24px) and let scale do the rest — it's faster, and it
matches the game's readable, watchable look.
