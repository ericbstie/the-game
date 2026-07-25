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

This project is a React + Bun browser game for **PC**, rendered on an HTML5 canvas. Generate
sprites **in code**: draw each once to an offscreen canvas, cache it, and blit the cache every
frame. No PNGs to load, no network, nothing to lose. Procedural stays the preference, but it is no
longer a hard rule — if procedural drawing cannot reach the style, the style wins
(`docs/adr/0002`).

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

Not for the characters — this style is ink contours, not pixel art. It suits the small hard-edged
**icons** (the HUD warning symbol, the unpowered-turret lightning), which are axis-aligned and want
no anti-aliasing at all. Rows of characters mapped to a palette are easy to tweak, diff-friendly,
and need no tooling.

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

const bolt = pixelSprite([
  '..##',
  '.##.',
  '####',
  '.##.',
  '##..',
], { '#': '#000' }, 4);
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

The game targets **PC only**, so the densities to expect are 1 on an ordinary monitor, 2 on a
retina laptop, and the fractional 1.25 or 1.5 that Windows display scaling produces. Nothing needs
to hold up at phone densities — but a fractional dpr does mean the bake's pixel size is rounded, so
work in logical units and let the bake round once.

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
front. Flips are the exception that does hold — a facing and its mirror are one drawing.

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

## Colour is forbidden by default

The game is **black and white** — ink contours, solid fills, no interior detail. There are no
palettes and no colour variants. Two exceptions have been granted, and no more without an explicit
grant: the **self halo** over your own avatar (a glow, barely yellow, mostly white) and **power
ore** (glowing red). Metal ore stays pure ink.

So what tells two things apart is the **silhouette** — the outline of the black shape, since at
these sizes there is no colour or shading to read. Spend the effort there.

## Sprite atlas (optional)

If you prefer one sheet, bake all sprites into a single canvas at known cells and
blit by rect: `drawImage(atlas, col*S, row*S, S, S, dx, dy, S, S)`. Keep a small
`{ name: [col, row] }` map so lookups read by name, not magic numbers.

## For this game specifically

Generate one baked sprite per entity type and reuse across all instances — there
may be hundreds of grunts on screen, but only one grunt canvas:

- **Player** — **one sprite shared by all six players**, upright. Squadmates are told apart by the
  name label above the head, and you find yourself by the halo. There is deliberately no per-player
  variant.
- **Grunt vs elite** — both spiders, body and face upright with legs splayed flat around them, and
  separated by **silhouette alone**: the grunt exaggerated into long legs, the elite into a large
  body instead.
- **Egg sac** — the spawner, drawn in elevation, in two states: intact and destroyed. Waves arrive
  unannounced, so it has no charging or telegraph frame.
- **Miner / wall / turret** — elevation, top surface and front face both visible, on the 15-unit
  tile grid (2×2 tiles each). **Generator** — flat, from above, 5×5 tiles. There is no landmine.
- **Ore (metal / power)** — ground texture, not entities: the same tile filling whole patches, metal
  in pure ink and power with its red glow. Density, not unique art, sells the field — and a full
  screen of it can't be culled, so bake it in bulk rather than per tile.

**The sizes are fixed by the zoom**, which does not change: 1 world unit = 1 CSS px, so a player is
~28 px, a grunt 32, an elite 48, a 2×2 building 30 and an ore tile 15. Draw for those sizes rather
than drawing small and scaling up.
