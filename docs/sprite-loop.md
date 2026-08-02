# The sprite loop

Every sprite in the game goes through this loop. It is mandated by
[ADR 0002](adr/0002-sprites-are-built-by-one-agent-each-with-a-reviewer.md) — one agent per
sprite, each spawning a subagent that **looks at** the result — and the numbers behind it were
measured in [#77](https://github.com/ericbstie/the-game/issues/77).

A sprite cannot be verified by a test suite. `bun test` can assert that a draw call happened; it
cannot say whether the drawing reads as 1930s ink, or whether two walk frames move naturally
between each other. So the loop ends in an image, and somebody looks at it.

## 1. Write the sprite

One file per sprite, `src/sprite/<name>.ts`, default-exporting a `SpriteSubject`. The full
contract an agent writes against — the name of every sprite in the set, the box each draws in, the
facing index, and what `facing` and `frame` mean — is
[`src/sprite/README.md`](../src/sprite/README.md):

```ts
import type { SpriteSubject } from "./sheet";

const grunt: SpriteSubject = {
  name: "grunt",
  size: 32, // the logical box, in world units — what the thing measures in the simulation
  facings: 8,
  frames: 2,
  draw(ctx, size, facing, frame) {
    // draw in a size × size box, in ink
  },
};

export default grunt;
```

- **`draw` works in logical units.** The harness has already scaled the context by the scale it is
  baking at and sized the offscreen canvas to `size × scale`. Never multiply by `dpr` yourself, and
  never read the camera's zoom — that scale is `dpr × zoom` (ADR 0008) and neither factor is yours.
- **The module must import cleanly under Bun** — no `document` at module scope. The runner computes
  the sheet's size without a canvas, because Chromium crops a screenshot to the window it was given
  and never says so.
- **`facing` is the variant axis and `frame` the animation axis.** For a character the variants
  are the 8 compass directions, fixed at `angle = facing / 8 × 2π` on a y-down canvas: 0 E, 1 SE,
  2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE. For everything else they are that sprite's own variants — the
  egg sac's two states, the grass tufts. The sheet lays them out in index order.
- **Nothing but that one file.** `registry.ts`, `draw.ts` and `cache.ts` are not yours to touch;
  wiring a sprite into the game is one line, added when the file is merged. That is what lets a
  dozen agents work at once without meeting in a shared file.

## 2. Render the review sheet

```sh
bun run sprite:sheet src/sprite/grunt.ts            # → src/sprite/grunt.sheet.png
bun run sprite:sheet src/sprite/grunt.ts --dpr 1    # check an ordinary, non-retina monitor
```

About a second. It writes the PNG **and** prints pixel facts measured on a real canvas: ink and
grey counts per bake, the box the ink actually covers, and a warning when a bake drew nothing or
runs into the edge of its box. Read those — they catch what the picture hides.

The sheet is one image with four panels, because a reviewer handed four files will not compare
them:

| Panel | Shows | Judge |
| --- | --- | --- |
| 1 · contact grid, 2× | every facing across, every frame down | drift between facings |
| 2 · real size on the floor | 1 world unit = 1 CSS px, exactly as the game blits it | readability — **this is the only panel that shows what a player sees** |
| 3 · magnified, smoothing off | real baked pixels, nearest-neighbour | artefacts |
| 4 · flip strip, 2× | the frames alternating and repeating | movement |

## 3. Spawn the reviewer

Not optional. Give the subagent the sheet's path and this brief:

> Look at `src/sprite/<name>.sheet.png` and report what is wrong with it. It shows one sprite four
> ways: **panel 1** every facing and frame at 2×, **panel 2** the sprite at real size on the floor,
> **panel 3** magnified with smoothing off, **panel 4** the frames alternating.
>
> Check:
> - it reads as **1930s rubber-hose cartoon ink** — bold contours, solid fills, no interior detail;
> - it is **black and white**, with no colour that was not explicitly granted;
> - **artefacts** of any kind, including the tell-tale artefacts of generated imagery;
> - **consistency between frames**, and whether the movement between them looks natural.
>
> Judge readability on panel 2, artefacts on panel 3, and movement on panel 4. **Do not judge the
> sprite from panel 1** — at 2× a 28 px sprite looks far better than it does in the game.

## 4. Record the review, then look yourself

The reviewer's findings go in `src/sprite/<name>.review.md`. They are **advisory**: nothing gates
on them, and a sprite ships with an unresolved note if its author decides it ships. The final call
is made by looking at the work in the game.

A sprite's deliverable is **three files** — `<name>.ts`, `<name>.sheet.png` and
`<name>.review.md` — committed together, so whoever opens the sheet already knows what its own
reviewer flagged.

Seeing it in a real frame of the game is a separate command, and needs no server or lobby:

```sh
bun run sprite:frame --sprite player=src/sprite/player.ts    # → sprite-frame.png
```

## Do not "fix" the anti-aliasing

At 28 px, roughly 70% of a contour drawn the obvious way comes out grey. That is not wrong ink; it
is not enough pixels. Every fix that suggests itself was measured and rejected (#77 §4 and its
addendum):

- **Thresholding to hard black** gives zero grey pixels and shatters the curves into a visible
  staircase, fragmenting thin strokes into dots. It passes a numeric check and looks wrong.
- **`putImageData`, testing each pixel centre**, genuinely aliases — and goes visibly polygonal at
  this size, an octagon rather than a circle.
- **`getContext("2d", { antialias: false })`** is silently ignored; the Chromium canvas-AA flags
  are no-ops, and would be flags the harness has and players do not.

Bake at the scale you are given and leave the rasteriser alone. Axis-aligned fills on integer edges carry no
anti-aliasing at all, so walls, elevation faces and the build ghost stay hard-edged for free.

## Checking the harness itself

```sh
bun run sprite:sheet src/sprite/calibration.ts
```

`calibration.ts` is a test pattern, not art — geometry chosen to exercise every panel. Use it to
confirm the harness works, then delete the sheet it wrote. Only a real sprite's sheet is committed.

`bun run sprite:frame` with no arguments does the same for the world frame, drawing the calibration
pattern where the player sprite goes.
