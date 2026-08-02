// The sprite review sheet: one image that shows a sprite four ways, so an agent can look at it
// and judge it. A sprite cannot be verified by a test suite — whether it reads as 1930s ink, and
// whether two walk frames move naturally between each other, has to be *looked at* (ADR 0002).
//
// Two things shape this module:
//
// - The layout is a **pure function of the subject**, so the runner can size the browser window
//   before launching. Chromium's `--screenshot` captures the viewport and crops a taller sheet
//   silently, so guessing is not an option (#77 §1).
// - Sprites **bake at `size × dpr` and blit into a `size`-CSS-px box**, mirroring the
//   `setTransform(dpr, …)` in `GameScreen`. A bake at logical size is upscaled by that transform
//   and reads as a smudge — 70% of a 28 px contour comes out grey (#77 §5). The sheet reproduces
//   the player's device pixels rather than describing them.

// What a sprite module hands the harness. `draw` works in a `size × size` logical box with the
// context already scaled by dpr, so it never sees the device resolution it is being baked at.
// `facing` and `frame` are indices only — what each facing points at is #73's to settle.
export interface SpriteSubject {
  name: string;
  size: number; // the logical box, in world units — what the thing measures in the simulation
  facings: number;
  frames: number;
  draw(ctx: CanvasRenderingContext2D, size: number, facing: number, frame: number): void;
}

export interface SheetBand {
  label: string;
  x: number;
  y: number; // top of the artwork; the label sits in the space above it
  width: number;
  height: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  contact: SheetBand;
  floor: SheetBand;
  magnified: SheetBand;
  flip: SheetBand | null; // nothing to flip between when a subject has one frame
  contactColumns: number;
  magnifyScale: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelFacts {
  ink: number; // opaque and near-black: ink that reads as ink
  grey: number; // covered but not ink, whether anti-aliased or translucent
  clear: number;
  bounds: Bounds | null; // of the covered pixels, in device px
}

export interface BakeMeasurement extends PixelFacts {
  facing: number;
  frame: number;
  width: number; // of the bake, in device px
  height: number;
}

// Uniform width for every sprite: sheets from a dozen agents are only comparable if they are the
// same shape. Height follows the subject's grid, which is why the runner has to ask for it.
const SHEET_WIDTH = 900;
const MARGIN = 16;
const HEADER_HEIGHT = 24;
const LABEL_HEIGHT = 18;
const BAND_GAP = 18;
const CELL_GAP = 6;
const CONTACT_SCALE = 2;
const FLOOR_PAD = 14;
const FLOOR_GAP = 10;
const MIN_MAGNIFY = 2;
const MAX_MAGNIFY = 8;
const FLIP_REPEATS = 3; // frame 0,1,0,1,0,1 — enough repeats to read as movement, not as two drawings

const PAGE = "#d8d8d8";
const PANEL = "#ffffff";
const EDGE = "#111111";
const TEXT = "#111111";
const INK_LEVEL = 32; // a covered pixel this dark, and fully opaque, counts as ink

// The panel labels double as the reviewer's brief: without them a reviewer judges everything from
// the contact grid, where a 28 px sprite is shown at 2× and looks far better than it does in the
// game (#77 §7).
const CONTACT_LABEL =
  "1 · contact grid, 2× — facings across, frames down. Judge drift between facings";
const FLOOR_LABEL = "2 · real size on the floor, 1 world unit = 1 CSS px. Judge readability here";
const MAGNIFIED_LABEL = "3 · magnified, smoothing off — real baked pixels. Judge artefacts here";
const FLIP_LABEL = "4 · flip strip, 2× — the frames alternating. Judge movement here";

// How many variants a sheet will show. A tiled sprite (#87) declares its cell grid times its
// neighbour mask — 2,304 for ore — and a sheet with a panel each is 11 MB of PNG that no reviewer
// can read. Sampling evenly keeps the artefact reviewable and still crosses the whole range,
// which is what the eye is being asked about.
const MAX_PANELS = 48;

// The variants a sheet draws: all of them when there are few, an even spread when there are many.
export function sheetFacings(facings: number): number[] {
  if (facings <= MAX_PANELS) return Array.from({ length: facings }, (_, i) => i);
  const step = facings / MAX_PANELS;
  return Array.from({ length: MAX_PANELS }, (_, i) => Math.floor(i * step));
}

export function layoutSheet(subject: SpriteSubject): SheetLayout {
  assertSubject(subject);
  const { size, frames } = subject;
  const facings = sheetFacings(subject.facings).length;
  const inner = SHEET_WIDTH - 2 * MARGIN;

  const contactCell = size * CONTACT_SCALE;
  const contactFit = gridFit(facings, contactCell, CELL_GAP, inner);
  const contactRows = contactFit.rows * frames;

  const floorFit = gridFit(facings, size, FLOOR_GAP, inner - 2 * FLOOR_PAD);

  // The magnified panel shows the first facing's frames side by side, as large as the width takes.
  const magnifiedCells = Math.min(frames, 2);
  const magnifyScale = clamp(
    Math.floor((inner - (magnifiedCells - 1) * CELL_GAP) / (magnifiedCells * size)),
    MIN_MAGNIFY,
    MAX_MAGNIFY,
  );

  const flipFit = gridFit(frames * FLIP_REPEATS, contactCell, CELL_GAP, inner);

  let y = MARGIN + HEADER_HEIGHT;
  const band = (label: string, height: number): SheetBand => {
    const top = y + LABEL_HEIGHT;
    y = top + height + BAND_GAP;
    return { label, x: MARGIN, y: top, width: inner, height };
  };

  const contact = band(CONTACT_LABEL, contactRows * (contactCell + CELL_GAP) - CELL_GAP);
  const floor = band(FLOOR_LABEL, floorFit.height + 2 * FLOOR_PAD);
  const magnified = band(MAGNIFIED_LABEL, size * magnifyScale);
  const flip = frames > 1 ? band(FLIP_LABEL, flipFit.height) : null;

  return {
    width: SHEET_WIDTH,
    height: y - BAND_GAP + MARGIN,
    contact,
    floor,
    magnified,
    flip,
    contactColumns: contactFit.columns,
    magnifyScale,
  };
}

export interface SheetRender {
  subject: SpriteSubject;
  bakes: HTMLCanvasElement[][]; // [frame][facing]
  dpr: number;
  // Panel 2's background. The default is the spec's white paper; the grass-tuft sprite supplies the
  // real field once it exists (#72), because a sprite judged on flat white is judged against a
  // background the game never shows (#77 §3).
  floor?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

// Paint the whole sheet. The caller has already scaled the context by dpr, so this draws in the
// same logical space the game draws in.
export function drawSheet(ctx: CanvasRenderingContext2D, render: SheetRender): void {
  const { subject, bakes, dpr } = render;
  const layout = layoutSheet(subject);
  const { size } = subject;

  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "bold 13px monospace";
  ctx.fillText(
    `${subject.name} · ${size}px box · ${subject.facings} facings × ${subject.frames} frames · baked at ${bakedPixels(size, dpr)}px for dpr ${dpr}`,
    MARGIN,
    MARGIN + 14,
  );

  // A tiled sprite declares thousands of variants; the sheet shows an even spread of them.
  const shown = sheetFacings(subject.facings);
  const cell = size * CONTACT_SCALE;
  const rowsPerFrame = Math.ceil(shown.length / layout.contactColumns);
  panel(ctx, layout.contact);
  for (let frame = 0; frame < subject.frames; frame++) {
    for (let i = 0; i < shown.length; i++) {
      const column = i % layout.contactColumns;
      const row = frame * rowsPerFrame + Math.floor(i / layout.contactColumns);
      ctx.drawImage(
        bakes[frame][shown[i]],
        layout.contact.x + column * (cell + CELL_GAP),
        layout.contact.y + row * (cell + CELL_GAP),
        cell,
        cell,
      );
    }
  }

  panel(ctx, layout.floor);
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.floor.x, layout.floor.y, layout.floor.width, layout.floor.height);
  ctx.clip();
  ctx.translate(layout.floor.x, layout.floor.y);
  (render.floor ?? whitePaper)(ctx, layout.floor.width, layout.floor.height);
  const floorColumns = gridFit(
    shown.length,
    size,
    FLOOR_GAP,
    layout.floor.width - 2 * FLOOR_PAD,
  ).columns;
  for (let i = 0; i < shown.length; i++) {
    const facing = shown[i];
    const column = i % floorColumns;
    const row = Math.floor(i / floorColumns);
    // Real size is the whole point of this panel: one bake pixel per device pixel, exactly as
    // `drawWorld` will blit it.
    ctx.drawImage(
      bakes[0][facing],
      FLOOR_PAD + column * (size + FLOOR_GAP),
      FLOOR_PAD + row * (size + FLOOR_GAP),
      size,
      size,
    );
  }
  ctx.restore();

  panel(ctx, layout.magnified);
  const magnified = size * layout.magnifyScale;
  ctx.imageSmoothingEnabled = false; // nearest-neighbour, so the reviewer sees real baked pixels
  for (let frame = 0; frame < Math.min(subject.frames, 2); frame++) {
    const x = layout.magnified.x + frame * (magnified + CELL_GAP);
    ctx.drawImage(bakes[frame][0], x, layout.magnified.y, magnified, magnified);
    ctx.strokeStyle = "#9a9a9a"; // the sprite's own box, so ink bleeding out of it is visible
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, layout.magnified.y + 0.5, magnified - 1, magnified - 1);
  }
  ctx.imageSmoothingEnabled = true;

  if (!layout.flip) return;
  panel(ctx, layout.flip);
  const flipColumns = gridFit(
    subject.frames * FLIP_REPEATS,
    cell,
    CELL_GAP,
    layout.flip.width,
  ).columns;
  for (let i = 0; i < subject.frames * FLIP_REPEATS; i++) {
    const column = i % flipColumns;
    const row = Math.floor(i / flipColumns);
    ctx.drawImage(
      bakes[i % subject.frames][0],
      layout.flip.x + column * (cell + CELL_GAP),
      layout.flip.y + row * (cell + CELL_GAP),
      cell,
      cell,
    );
  }
}

// How many device pixels a `size`-CSS-px box bakes to at this ratio. The whole pipeline turns on
// this being one number: the offscreen canvas is this wide, and the blit's destination has to be
// exactly this many device pixels or the bake is resampled on its way to the screen. `size × dpr`
// is not always a whole number — a 15 px ore tile at Windows' 1.5× scaling wants 22.5 — so it is
// rounded here, once, and everything else divides back out of this rather than rounding again.
export function bakedPixels(size: number, dpr: number): number {
  return Math.round(size * dpr);
}

// Bake every facing and frame at `size × dpr`. This is the one rule a sprite must be produced
// under, so the harness owns it rather than asking a dozen agents to remember it (#77 §5).
export function bakeSubject(subject: SpriteSubject, dpr: number): HTMLCanvasElement[][] {
  assertSubject(subject);
  return Array.from({ length: subject.frames }, (_, frame) =>
    Array.from({ length: subject.facings }, (_, facing) => bakeOne(subject, dpr, facing, frame)),
  );
}

// One variant, baked on its own. Sprites whose variant count is a *product* — an ore tile's
// position cell times its neighbour mask — declare thousands of combinations while a single frame
// ever asks for a few hundred, so baking the whole grid up front would cost far more memory and
// far more stall than the sprite is worth. Baking one at a time makes the bill track what is
// actually drawn.
export function bakeOne(
  subject: SpriteSubject,
  dpr: number,
  facing: number,
  frame: number,
): HTMLCanvasElement {
  const pixels = bakedPixels(subject.size, dpr);
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context: sprites can only be baked in a real browser");
  ctx.scale(dpr, dpr);
  subject.draw(ctx, subject.size, facing, frame);
  return canvas;
}

// The harness's second channel: pixel facts a spy context can never see, read off a real canvas
// and reported through `--dump-dom` (#77 §2). Numbers, not a verdict — the looking is the review.
export function measureBakes(bakes: HTMLCanvasElement[][]): BakeMeasurement[] {
  const measurements: BakeMeasurement[] = [];
  for (let frame = 0; frame < bakes.length; frame++) {
    for (let facing = 0; facing < bakes[frame].length; facing++) {
      const bake = bakes[frame][facing];
      const ctx = bake.getContext("2d");
      if (!ctx) throw new Error("no 2d context: bakes can only be measured in a real browser");
      const { data } = ctx.getImageData(0, 0, bake.width, bake.height);
      measurements.push({
        facing,
        frame,
        width: bake.width,
        height: bake.height,
        ...measurePixels(data, bake.width, bake.height),
      });
    }
  }
  return measurements;
}

export function measurePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelFacts {
  let ink = 0;
  let grey = 0;
  let clear = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3];
      if (alpha === 0) {
        clear++;
        continue;
      }
      const dark = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) <= INK_LEVEL;
      if (alpha === 255 && dark) ink++;
      else grey++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const bounds =
    maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { ink, grey, clear, bounds };
}

function panel(ctx: CanvasRenderingContext2D, band: SheetBand): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(band.x, band.y, band.width, band.height);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(band.x - 0.5, band.y - 0.5, band.width + 1, band.height + 1);
  ctx.fillStyle = TEXT;
  ctx.font = "12px monospace";
  ctx.fillText(band.label, band.x, band.y - 5);
}

function whitePaper(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(0, 0, width, height);
}

// How many cells of `cell` fit across `inner`, and how many rows that takes. Wrapping keeps a
// wide subject inside the fixed sheet width instead of overflowing off the edge of the PNG.
function gridFit(
  count: number,
  cell: number,
  gap: number,
  inner: number,
): { columns: number; rows: number; height: number } {
  const columns = Math.max(1, Math.min(count, Math.floor((inner + gap) / (cell + gap))));
  const rows = Math.ceil(count / columns);
  return { columns, rows, height: rows * (cell + gap) - gap };
}

function assertSubject(subject: SpriteSubject): void {
  const whole = (value: number) => Number.isInteger(value) && value > 0;
  if (!whole(subject.size) || !whole(subject.facings) || !whole(subject.frames)) {
    throw new Error(
      `sprite subject "${subject.name}": size, facings and frames must be whole numbers above zero`,
    );
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
