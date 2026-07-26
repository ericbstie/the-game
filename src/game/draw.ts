import type {
  Avatar,
  BuildableKind,
  EnemyKind,
  OreKind,
  PlayerId,
  RenderedEnemy,
  RenderedNest,
  Tile,
  Vec2,
  WorldSnapshot,
} from "../lobby/protocol";
import type { BakedSprite, SpriteSource } from "../sprite/cache";
import type { SpriteName } from "../sprite/registry";
import {
  BUILDABLES,
  footprintCenter,
  oreAt,
  TILE,
  TURRET_CADENCE_MS,
  tileKey,
  tileOf,
} from "./build";
import { type Camera, isVisible, type Viewport } from "./camera";
import type { ShotEvent } from "./clientWorld";
import { ELITE_HP, GRUNT_HP, NEST_HP, RANGED_RANGE } from "./enemies";
import { PLAYER_MAX_HP } from "./world";

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
//
// Beyond the art, M5 gives this file everything #81 says the world itself tells the player, and
// nothing else — no wave warning, no structure damage state, no hit or death effect:
//
// - **A health bar on anything damaged**, and on nothing at full health. It is the *only* damage
//   readout, because a structure deliberately does not change appearance as it is worn down.
// - **A shot line**, for your own shots, your squadmates' and your turrets' alike. It is the most
//   expensive thing in the frame per unit, so its 100 ms lifetime is a budget and not a look.
// - **Death by vanishing** — no corpse — plus a screen darkening drawn only on the dying player's
//   own client, for as long as they are down.

// How long one shot's line stays on screen, client-side. No duration ever rides the wire and the
// server holds no line state (#74 §5). Half `TURRET_CADENCE_MS`, so a turret's pulse train reads as
// discrete shots rather than as a continuous beam, and ~6 frames at 60 Hz, so one shot is visible.
//
// It is also the whole cost control. A stroked line across the viewport is the most expensive thing
// in the frame per unit — ~34 µs, sixteen sprite blits — because it covers far more pixels than a
// 32 px sprite. At 150 shot events a second a 1-second lifetime would put ~150 lines on screen for
// 5.7 ms; 100 ms holds it near the budgeted 50 (`docs/frame-budget.md`).
export const SHOT_LINE_MS = 100;

// The owner's own shot, recorded where it is fired rather than round-tripped: the server relays it
// to the squad, but drawing the relay would put a second line up a tick late and from the position
// the shooter had then. `from` is the origin the attack was actually sent with.
export interface OwnShot {
  at: number;
  from: Vec2;
  dir: Vec2;
}

// Everything the render layer needs to put this frame's shot lines up, kept as one bag because a
// line is meaningless without all three parts.
//
// `resolve` is the authority guard, and it is the reason the render layer cannot assemble these on
// its own: a target id outlives its target by one tick in two places — a turret still names the
// enemy it just killed until it re-targets, and a killing `PeerShot` rides the same delta as the
// death it caused. `ClientWorld.shotTargetPos` answers null for both, which is what stops a line
// depicting damage the server did not apply (#74 §7).
export interface ShotSource {
  peers: ShotEvent[]; // `ClientWorld.peerShots(now, SHOT_LINE_MS)` — already aged
  own: OwnShot | null;
  resolve: (targetId: string) => Vec2 | null;
}

// The tile-snapped preview under the cursor while a buildable is selected. `valid` drives the
// opacity — full when it can be placed, semi-transparent when it cannot (#81) — so the player
// learns a placement is refused before spending the click.
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
  // This frame's shot lines. Absent — in a test, or before the first shot — nothing is drawn.
  shots?: ShotSource;
  // Baked art, or nothing. Absent — in a test, or before the first sprite lands — every entity
  // falls back to its shape, which is what keeps this one draw path the only one.
  sprites?: SpriteSource;
  // Device pixels per CSS pixel, matching the `setTransform(dpr, …)` the caller paints through.
  // Blits are aligned to whole device pixels with it; nothing else here needs it.
  dpr?: number;
  // Wall-clock ms, injected rather than read, so this stays a pure function of its arguments (the
  // `stepBuild` idiom). Only the flashing overlays use it; without it they sit on their first frame.
  now?: number;
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

// How fast a flashing overlay alternates. The spec asks for a flash and fixes no rate; this is
// slow enough to read as deliberate and fast enough to catch the eye mid-fight.
const FLASH_MS = 400;

// The room's perimeter is one sprite with a variant per edge, unfolded outward (#76 §2), plus the
// door set into whichever edge the exit falls on.
const ROOM_NORTH = 0;
const ROOM_EAST = 1;
const ROOM_SOUTH = 2;
const ROOM_WEST = 3;
// The door variants run parallel to the four edges, so a door carries the edge it is set into:
// `ROOM_DOOR + ROOM_EAST` is the east door. One shared door tile is not possible — the wall's
// profile is asymmetric top to bottom, so an orientation-free tile is invariant under a vertical
// flip, and no vflip-invariant tile can match both an asymmetric wall's ends. That is arithmetic,
// not taste, so the edge is resolved here rather than designed around in the sprite.
const ROOM_DOOR = 4;

// A buildable wall's variant is a 4-bit mask of which sides another wall abuts, one bit per compass
// point, so 0 is a wall standing alone and 15 is one buried inside a mass. The sprite draws a cut
// masonry face on every side the mask leaves clear and nothing at all on the others, which is what
// turns a row of tiles into one continuous top surface instead of a seam every 30 px.
//
// The mask is a render-layer derivation and nothing else: it never rides the wire, never reaches the
// sim, and adds nothing to the `SpriteSubject` contract — it is the `facing` axis, used for what a
// wall actually has instead of an orientation it does not.
const WALL_NORTH = 1;
const WALL_EAST = 2;
const WALL_SOUTH = 4;
const WALL_WEST = 8;

// One stable colour per slot (1..6), so a player keeps their colour across the match.
const SLOT_COLORS = ["#4f8cff", "#ff5d5d", "#40c463", "#f2c14e", "#c77dff", "#4dd0e1"];

// The floor is white paper (#76 §3). Not decoration: the whole set is black ink, so on M2's
// near-black ground the spiders were invisible and every white-bodied sprite — the egg sac, the
// generator, the miner — read inverted. Pure white rather than an off-white, because a tinted
// paper is a colour and #76 grants exactly two of those, neither of them this.
const PAPER = "#ffffff";
const WALL = "#2a2a35";
const NEST = "#8e44ad"; // spawner nests
const NEST_DEAD = "#3a2d44"; // a silenced (destroyed) nest
// Ink, matching what the sprite modules draw with, so a label, a ring, a health bar or a shot line
// reads as part of the same drawing. It was near-white when the floor was dark, and would now be
// invisible on it.
const INK = "#000";
const LABEL_PAD = 30; // extra top margin so an avatar's name doesn't pop as it scrolls off

// A shot is one stroked line, and #81 asks for exactly that: continuous ink, shooter to target,
// with no travelling projectile (#80 is out of scope). Two logical px so it survives being drawn
// diagonally at dpr 1 without reading as a rule.
const SHOT_WIDTH = 2;

// The damage readout, and the only thing that carries it: structures deliberately do not change
// appearance as they are damaged (#81). Four px tall, which is a one-px ink frame around two px of
// signal — the frame is what keeps the bar legible over a sprite as well as over bare paper.
const BAR_HEIGHT = 4;
const BAR_GAP = 3; // clear paper between the top of the drawing and the bar above it

// Your own screen while you are down. A second full-viewport pass costs about what the paper fill
// does (~1.6 ms), which is affordable for exactly the reason `docs/frame-budget.md` rule 2 gives:
// only the dying player's own client draws it, and only for the 20 s they are down.
const DOWNED_DIM = "rgba(0, 0, 0, 0.55)";

// What a placement looks like. #81 makes validity a matter of opacity alone — more solid when it
// can be placed, less when it cannot — so there is no second colour and no refusal mark here; the
// ghost is simply the building you are about to place, faded.
//
// A *valid* ghost is held just off solid rather than at literal full opacity (#88 §1). At 1.0 it
// was pixel-identical to a building already standing there, so a player lining a wall up against
// an existing run could not tell the preview from the real thing without moving the cursor. 0.85
// still reads as clearly-placeable next to 0.45, and it keeps validity a matter of opacity rather
// than introducing the second channel #81 set out to remove.
const GHOST_VALID_ALPHA = 0.85;
const GHOST_BLOCKED_ALPHA = 0.45;

// One colour per enemy kind; the elite reads darker and, with its larger radius, distinct.
const ENEMY_COLORS: Record<EnemyKind, string> = { grunt: "#e8643c", elite: "#a01f1f" };

// What "full health" means for each kind, so a bar can be withheld from anything undamaged. Read
// from the simulation rather than restated, or an HP rebalance would leave every enemy permanently
// showing a bar that never fills.
const ENEMY_MAX_HP: Record<EnemyKind, number> = { grunt: GRUNT_HP, elite: ELITE_HP };

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

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  options: DrawOptions,
): void {
  const { arena } = world;
  const { camera, viewport, sprites, dpr = 1, now = 0 } = options;
  const flash = Math.floor(now / FLASH_MS);

  // Every blit below is one device pixel per baked pixel: `BakedSprite.size` is the CSS width that
  // comes out to exactly the bake's device-pixel width, and `snap` puts its corner on a whole
  // device pixel, so there is nothing left for smoothing to interpolate (#77 §5). Turning it off
  // is therefore not what makes sprites crisp — the 1:1 geometry is. It is here so that a sprite
  // which ever *does* drift off that alignment shows it, instead of being quietly blurred into
  // looking almost right. Set per frame, not once: `GameScreen` resizes the backing store when the
  // DPR changes, and assigning `canvas.width` resets the whole 2D drawing state with it.
  ctx.imageSmoothingEnabled = false;

  // Clear and repaint only the visible slice of the world, not the whole 31,200² arena.
  ctx.clearRect(camera.x, camera.y, viewport.width, viewport.height);
  ctx.fillStyle = PAPER;
  ctx.fillRect(camera.x, camera.y, viewport.width, viewport.height);

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

  // Overlays — the self halo, a turret's lightning — mark something rather than stand on the
  // floor, so they hang off their centre instead of their feet.
  const blitOver = (sprite: BakedSprite, x: number, y: number): void => {
    ctx.drawImage(
      sprite.image,
      snap(x - sprite.size / 2, camera.x, dpr),
      snap(y - sprite.size / 2, camera.y, dpr),
      sprite.size,
      sprite.size,
    );
  };

  // Grass first, ore over it: an ore tile is a patch of mineral in the ground rather than something
  // growing on it, and it fills its tile edge to edge, so tufts underneath would be both invisible
  // and muddling to read.
  drawGrass(camera, viewport, sprites, blit);
  drawOre(ctx, world, camera, viewport, sprites, blit);

  const standing: Standing[] = [];

  // The room's walls stand up like everything else, so they join the sort rather than sitting
  // under it: the near wall has to paint in front of a player standing against it, and the far
  // wall behind. Without the sprite the perimeter falls back to the M2 outline.
  //
  // The exit had a fallback rectangle of its own here and no longer does. It was `#39d353`, a
  // colour #76 never granted, and the `room` sprite has landed — the door is now the variant the
  // wall run switches to where it crosses the exit, so nothing the player can see reached the
  // rectangle any more.
  if (!pushRoom(world, camera, viewport, sprites, blit, standing)) {
    ctx.strokeStyle = WALL;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, arena.width - 4, arena.height - 4);
  }

  for (const n of world.nests) {
    if (!isVisible(n.pos, n.radius * 2, camera, viewport)) continue;
    standing.push({
      y: n.pos.y,
      paint: () => {
        paintNest(ctx, n, sprites, blit);
        paintNestHealth(ctx, n);
      },
    });
  }

  // Built once for the whole frame, not once per wall: every wall asks the same question of the
  // same answer, and a set of the tiles walls cover turns each of those questions into a lookup.
  // Walls off screen are in it too — the run a visible wall belongs to does not stop at the
  // viewport edge, and a wall whose neighbour was culled would grow a face that is not there.
  const walls = wallTiles(world.structures);

  for (const s of world.structures) {
    const spec = BUILDABLES[s.kind];
    if (!spec) continue;
    const side = spec.footprint * TILE;
    if (!isVisible(footprintCenter(s.tile, spec.footprint), side / 2, camera, viewport)) continue;
    // A building's box *is* its footprint, so its floor line is the front edge of that square.
    const paint = () => {
      paintStructure(
        ctx,
        s.kind,
        s.tile,
        side,
        sprites,
        blit,
        wallFacing(s.kind, s.tile, spec.footprint, walls),
      );
      // A turret holding a target it has no power to fire on. `powered` alone cannot say it — an
      // idle turret is unpowered too, and has nothing to complain about (#74).
      if (s.turret?.targetId != null && !s.turret.powered) {
        const lightning = sprites?.("unpowered", 0, flash);
        if (lightning) blitOver(lightning, ...centreOf(s.tile, side));
      }
      healthBar(ctx, s.tile.tx * TILE + side / 2, s.tile.ty * TILE, side, s.hp, spec.hp);
    };
    if (FLAT[s.kind]) paint();
    else standing.push({ y: (s.tile.ty + spec.footprint) * TILE, paint });
  }

  for (const e of world.enemies) {
    if (!isVisible(e.pos, e.radius * 2, camera, viewport)) continue;
    standing.push({ y: e.pos.y, paint: () => paintEnemy(ctx, e, sprites, blitOver) });
  }

  // A player's name and bar do not join the sort. They are collected here and painted in one pass
  // after every body, because a halo is wider than the figure it marks and would otherwise cover a
  // squadmate's name — see `paintOverhead`.
  const overhead: (() => void)[] = [];

  for (const a of world.players) {
    // A dead player vanishes instantly — no corpse (#81). What replaced the M2 fade is the screen
    // darkening below, and it is the dying player's own view only: squadmates simply see you gone.
    if (a.hp <= 0) continue;
    if (!isVisible(a.pos, a.radius * 2, camera, viewport, LABEL_PAD)) continue;
    standing.push({
      y: a.pos.y,
      paint: () => paintAvatar(ctx, a, a.id === options.selfId, sprites, blit, blitOver),
    });
    overhead.push(() => paintOverhead(ctx, a, sprites));
  }

  // Lower on screen paints later, so it paints in front. The sort is stable (ES2019), so two
  // things sharing a floor line keep collection order and every client resolves the tie the same
  // way. At ~250 standing entities this whole pass — collect, sort and dispatch — costs ~0.04 ms.
  standing.sort((a, b) => a.y - b.y);
  for (const entry of standing) entry.paint();

  // Over the sort, not in it: a shot is an event between two things rather than a thing standing on
  // the floor, and a line half-hidden behind the spider it ends at says nothing.
  drawShots(ctx, world, options);

  // Names last of everything in the world. They are on ADR 0001's short allowlist — almost nothing
  // else may be written on screen — so nothing the world draws is allowed to obscure one.
  for (const paint of overhead) paint();

  // The ghost paints last so it reads on top of whatever it would replace, and it paints as the
  // building itself — the same sprite, at the same tile — because #81 spends opacity on validity
  // and leaves nothing to spend on a second silhouette.
  const ghost = options.ghost;
  const ghostSpec = ghost && BUILDABLES[ghost.kind];
  if (ghost && ghostSpec) {
    ctx.globalAlpha = ghost.valid ? GHOST_VALID_ALPHA : GHOST_BLOCKED_ALPHA;
    // The ghost takes the neighbour mask too, off the walls that are actually standing, so a wall
    // laid onto the end of a run previews the join it will make rather than a fresh four-sided
    // block. The run it joins keeps its own faces until the placement lands: the ghost is a preview
    // of the tile under the cursor, not of a structure list the server has not agreed to yet.
    paintStructure(
      ctx,
      ghost.kind,
      ghost.tile,
      ghostSpec.footprint * TILE,
      sprites,
      blit,
      wallFacing(ghost.kind, ghost.tile, ghostSpec.footprint, walls),
    );
    ctx.globalAlpha = 1;
  }

  // Last of all, and only ever on the dying player's own screen.
  const self = world.players.find((p) => p.id === options.selfId);
  if (self && self.hp <= 0) {
    ctx.fillStyle = DOWNED_DIM;
    ctx.fillRect(camera.x, camera.y, viewport.width, viewport.height);
  }
}

// The frame's shot lines: your own, your squadmates' and your turrets' (#81), all the same ink.
//
// Aged here rather than upstream. `ClientWorld` keeps shots for `SHOT_RETENTION_MS` (250) as a
// memory bound, which is deliberately longer than any lifetime a caller might ask for; drawing
// everything it holds would put two and a half times the budgeted lines on screen.
//
// Turret shots have no per-shot event to age, because none is sent: a turret's `(target, powered)`
// pair is streamed as a transition, so the client generates the pulse train itself — one pulse
// every `TURRET_CADENCE_MS` for as long as that state holds, each lasting `SHOT_LINE_MS` (#74 §5).
// The generated phase can sit up to a cadence out of step with the server's real cooldown, which is
// invisible at 200 ms and cannot misrepresent damage: the server is applying `TURRET_DAMAGE` on
// exactly that cadence for as long as the state the pulse is derived from holds.
function drawShots(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  { shots, camera, viewport, now = 0 }: DrawOptions,
): void {
  if (!shots) return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = SHOT_WIDTH;

  const line = (from: Vec2, to: Vec2): void => {
    // A line can be long enough to cross the whole viewport, so it is culled on the box it spans
    // rather than on either end: a turret off the left edge firing at a nest off the right one is
    // still drawn across the middle of the screen.
    if (Math.max(from.x, to.x) < camera.x || Math.min(from.x, to.x) > camera.x + viewport.width) {
      return;
    }
    if (Math.max(from.y, to.y) < camera.y || Math.min(from.y, to.y) > camera.y + viewport.height) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  if (shots.own && now - shots.own.at < SHOT_LINE_MS) {
    line(shots.own.from, reach(shots.own.from, shots.own.dir));
  }

  for (const { shot, at } of shots.peers) {
    if (now - at >= SHOT_LINE_MS) continue;
    // The origin is not on the wire: the shooter's own rendered position is already within a
    // player-diameter of where the server saw it (#74 §3). A peer who has since left has none.
    const from = world.players.find((p) => p.id === shot.id)?.pos;
    if (!from) continue;
    // A ray that hit nothing still draws, out to full range — a squadmate firing into empty air
    // with no line looks broken (#74 §6). A ray that hit something the client cannot resolve draws
    // nothing at all: that is the death window, and it is the one case a line would be a lie.
    const to = shot.hit === undefined ? reach(from, shot.dir) : shots.resolve(shot.hit);
    if (to) line(from, to);
  }

  if (now % TURRET_CADENCE_MS >= SHOT_LINE_MS) return;
  for (const s of world.structures) {
    if (!s.turret?.powered || s.turret.targetId === null) continue;
    const spec = BUILDABLES[s.kind];
    const to = spec && shots.resolve(s.turret.targetId);
    if (to) line(footprintCenter(s.tile, spec.footprint), to);
  }
}

// Where a shot that hit nothing ends: full range along the aim vector, which the server admitted as
// a unit vector.
function reach(from: Vec2, dir: Vec2): Vec2 {
  return { x: from.x + dir.x * RANGED_RANGE, y: from.y + dir.y * RANGED_RANGE };
}

// The damage readout for one entity, sitting above whatever was drawn for it. Nothing at full
// health shows a bar (#81) — the absence is the "undamaged" state, so there is no full bar to
// mistake for one.
//
// Two axis-aligned fills on integer edges, which carry no anti-aliasing at all and cost ~1.7 µs
// each: the ink bar entire, then the missing share knocked back out to paper. That way the frame
// around it is ink whatever the health, so the bar reads over a black sprite as well as over the
// white floor — which a fill-only bar does not.
function healthBar(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  width: number,
  hp: number,
  maxHp: number,
): void {
  if (hp >= maxHp) return;
  const x = Math.round(centerX - width / 2);
  const y = Math.round(topY - BAR_GAP - BAR_HEIGHT);
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, width, BAR_HEIGHT);
  const lost = Math.round((width - 2) * (1 - Math.max(0, hp) / maxHp));
  ctx.fillStyle = PAPER;
  ctx.fillRect(x + width - 1 - lost, y + 1, lost, BAR_HEIGHT - 2);
}

// How thickly the tufts fall: one tuft per this many tiles, on average. Chosen by rendering a
// ladder of densities at real size and looking, which is the only way this could honestly be
// settled — at one per 8 (~280 a screen) the scatter closes up into a continuous texture and starts
// competing with the ink sprites standing on it, which is the exact failure the white floor was
// brought in to fix; at one per 24 (~100) the floor opens into bare voids most of a screen across
// and the grass stops reading as a property of the ground. One per 12 is ~200 tufts on an 800×600
// screen — about one per 2,400 px² — the densest setting that still reads as marks on paper rather
// than as ground cover.
const GRASS_PERIOD = 12;

// Where a tile's tuft falls, or null for the tiles that carry none.
//
// Pure arithmetic on the tile coordinate — the `oreSeed` derive-don't-stream idiom — so all six
// clients scatter the identical field with nothing on the wire and nothing in the snapshot (#76 §3).
// The offset within the tile comes from a second hash rather than from the first one's spare bits,
// so the tufts do not line up on the lattice that chose them; without it the scatter reads as a
// grid at a glance, which is the very thing the pattern mechanism was rejected for.
export function grassAt(tx: number, ty: number): { x: number; y: number; variant: number } | null {
  if (tileVariant(tx, ty) % GRASS_PERIOD !== 0) return null;
  const jitter = tileVariant(tx + 1, ty * 3 + 7);
  // Over 256, not 255, so the offset is [0, 1) and a tuft can never land exactly on the next tile's
  // edge — which would put it outside the tile that chose it and out of the walk's reach.
  return {
    x: tx * TILE + ((jitter & 0xff) / 256) * TILE,
    y: ty * TILE + (((jitter >>> 8) & 0xff) / 256) * TILE,
    variant: jitter >>> 16,
  };
}

// Scatter the tufts over the paper, walking only the tiles the camera can see.
//
// Per-tuft blits, and deliberately not a `CanvasPattern` or a chunk cache. Measured against both at
// this density (#72): a pattern fill and a chunk blit each cost ~0.7–0.8 ms because they composite
// every pixel of the viewport whether or not there is ink in it, while ~200 individual blits cost
// ~0.45 ms because they only touch the pixels that carry a tuft. Below roughly 300 tufts a screen
// the simplest mechanism is also the fastest one — and it is the only one of the three with no
// cache to evict across a 2,080 × 2,080 tile world, and no repeat for the eye to find.
//
// Nothing here is culled, because the floor *is* the screen; the walk is bounded to visible tiles
// instead, so a 31,200² arena costs exactly what an 800 px one does. The tile scan itself measured
// 0.03 ms over 2,255 tiles, so the cost is the blits and only the blits.
function drawGrass(
  camera: Camera,
  viewport: Viewport,
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  // One probe up front, exactly as the ore does: until the grass module lands, the floor is bare
  // paper and this whole pass costs a single lookup.
  const probe = sprites?.("grass", 0, 0);
  if (!probe) return;
  const source = sprites as SpriteSource;
  const first = tileOf({ x: camera.x, y: camera.y });
  const last = tileOf({ x: camera.x + viewport.width, y: camera.y + viewport.height });
  // A tuft is foot-anchored and centred, so it reaches a whole box above the tile that chose it and
  // half a box either side. Derived from the sprite rather than hard-coded, so a tuft drawn larger
  // than a tile still cannot pop in at the viewport edge.
  const margin = Math.ceil(probe.size / TILE);
  for (let ty = Math.max(0, first.ty - margin); ty <= last.ty + margin; ty++) {
    for (let tx = Math.max(0, first.tx - margin); tx <= last.tx + margin; tx++) {
      const tuft = grassAt(tx, ty);
      if (!tuft) continue;
      const sprite = source("grass", tuft.variant, 0);
      if (sprite) blit(sprite, tuft.x, tuft.y);
    }
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
  sprites: SpriteSource | undefined,
  blit: Blit,
): void {
  const first = tileOf({ x: camera.x, y: camera.y });
  const last = tileOf({ x: camera.x + viewport.width, y: camera.y + viewport.height });

  // Once ore is drawn it is a tile at a time, because two neighbouring tiles are different
  // drawings and there is no run to merge. That is affordable where a flat fill would not be:
  // ore is scattered in patches over a 2,080² grid, so only a small share of the visible tiles
  // carry any. Probing both kinds up front keeps the common case — no ore art yet — on exactly
  // the run-length path it has always used.
  if (sprites?.("ore-metal", 0, 0) || sprites?.("ore-power", 0, 0)) {
    for (let ty = Math.max(0, first.ty); ty <= last.ty; ty++) {
      for (let tx = Math.max(0, first.tx); tx <= last.tx; tx++) {
        const kind = oreAt(world.ore, { tx, ty });
        if (kind === null) continue;
        const sprite = sprites(ORE_SPRITES[kind], oreCell(tx, ty), 0);
        if (sprite) blit(sprite, tx * TILE + sprite.size / 2, ty * TILE + sprite.size);
        else {
          ctx.fillStyle = ORE_COLORS[kind];
          ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        }
      }
    }
    return;
  }

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

const ORE_SPRITES: Record<OreKind, SpriteName> = {
  metal: "ore-metal",
  power: "ore-power",
};

// Which variant of a scattered floor sprite a tile gets. Pure arithmetic on the tile coordinate,
// so every client derives the same field with nothing on the wire — the same derive-don't-stream
// idiom the ore grid itself uses. The cache wraps whatever comes out into the sprite's range, so
// this never has to know how many variants an agent drew.
// How many tiles an ore sprite's variant grid repeats over. An ore tile's variant is its *position*
// modulo this, not a hash of its position, which is what lets a tile derive its neighbours' cells
// and draw a mark that straddles a seam identically from both sides. A hash cannot do that: it is
// measurably uniform (χ²=84 on 95 df at N=96) but tells a tile nothing about who it sits next to,
// so every mark stays boxed in its own cell and a 4–7× ink deficit forms on the grid pitch.
//
// Twelve is the smallest period past `METAL_PATCH_MAX` (80 tiles, ~11 across), so no patch the
// generator can grow contains the same cell twice and no two adjacent tiles are ever identical —
// the repetition is closed outright rather than made unlikely. An ore sprite therefore declares
// `facings: ORE_CELLS * ORE_CELLS`.
const ORE_CELLS = 12;

function oreCell(tx: number, ty: number): number {
  return (
    (((tx % ORE_CELLS) + ORE_CELLS) % ORE_CELLS) * ORE_CELLS +
    (((ty % ORE_CELLS) + ORE_CELLS) % ORE_CELLS)
  );
}

function tileVariant(tx: number, ty: number): number {
  const mixed = Math.imul((tx * 73_856_093) ^ (ty * 19_349_663), 0x45d9f3b);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

function centreOf(tile: Tile, side: number): [x: number, y: number] {
  return [tile.tx * TILE + side / 2, tile.ty * TILE + side / 2];
}

// Tile the room's perimeter into the sorted pass, one segment per box along each visible edge,
// and return whether it drew anything. Only the span the camera can see is walked, so a 31,200²
// arena costs exactly what an 800 px one does.
//
// The door is not a separate sprite: it is the variant the wall run switches to where it crosses
// the exit, which is what makes it a door *set into* the wall rather than a gap in it (#76 §3).
function pushRoom(
  world: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
  sprites: SpriteSource | undefined,
  blit: Blit,
  standing: Standing[],
): boolean {
  const wall = sprites?.("room", ROOM_NORTH, 0);
  if (!sprites || !wall) return false;
  const source = sprites;
  const band = wall.size;
  const { width, height } = world.arena;
  const { exit } = world;
  const left = Math.max(0, camera.x);
  const right = Math.min(width, camera.x + viewport.width);
  const top = Math.max(0, camera.y);
  const bottom = Math.min(height, camera.y + viewport.height);

  const segment = (facing: number, x: number, y: number): void => {
    // A segment straddling the exit is the door instead. Both are the same size, so the run stays
    // on its grid either way.
    const door =
      x < exit.x + exit.width && x + band > exit.x && y < exit.y + exit.height && y + band > exit.y;
    const sprite = source("room", door ? ROOM_DOOR + facing : facing, 0);
    if (sprite) blit(sprite, x + band / 2, y + band);
  };
  const across = (facing: number, y: number): void => {
    for (let x = Math.floor(left / band) * band; x < right; x += band) {
      const at = x;
      standing.push({ y: y + band, paint: () => segment(facing, at, y) });
    }
  };
  const down = (facing: number, x: number): void => {
    for (let y = Math.floor(top / band) * band; y < bottom; y += band) {
      const at = y;
      standing.push({ y: at + band, paint: () => segment(facing, x, at) });
    }
  };

  if (camera.y < band) across(ROOM_NORTH, 0);
  if (camera.y + viewport.height > height - band) across(ROOM_SOUTH, height - band);
  if (camera.x < band) down(ROOM_WEST, 0);
  if (camera.x + viewport.width > width - band) down(ROOM_EAST, width - band);
  return true;
}

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

// #81 granted bars to "enemies, peers and structures". A nest is none of those three and so got
// none — despite NEST_HP 600 being the longest single fight in the game, and the one readout with
// real tactical weight, since killing a nest is how a sector is silenced (#88 §2).
//
// A silenced nest is skipped rather than shown empty: it is wreckage, not a fight in progress, and
// the destroyed sprite already says so.
function paintNestHealth(ctx: CanvasRenderingContext2D, nest: RenderedNest): void {
  if (!nest.alive) return;
  healthBar(ctx, nest.pos.x, nest.pos.y - nest.radius, nest.radius * 2, nest.hp, NEST_HP);
}

// Every tile a wall stands on, so a wall can be asked what it abuts. Only walls go in: a miner
// butted against a wall is a different building and the wall's face is still cut where it meets one.
function wallTiles(structures: WorldSnapshot["structures"]): Set<number> {
  const tiles = new Set<number>();
  const footprint = BUILDABLES.wall?.footprint;
  if (!footprint) return tiles;
  for (const s of structures) {
    if (s.kind !== "wall") continue;
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        tiles.add(tileKey({ tx: s.tile.tx + dx, ty: s.tile.ty + dy }));
      }
    }
  }
  return tiles;
}

// A wall's neighbour mask, and 0 for everything else — the miner, the turret and the generator each
// have one drawing and take the facing axis for nothing.
//
// A face counts as covered when **any** tile of the strip alongside it carries a wall, rather than
// when a wall's own tile sits exactly a footprint away. Placement is per tile and not snapped to the
// footprint (`cursorTile` → `tileOf`, GameScreen.tsx), so two walls can butt while sitting a single
// tile out of step with each other; the strip test sees that join and a `tx ± 2` test would miss it
// and draw a masonry face into the middle of a solid mass.
function wallFacing(
  kind: BuildableKind,
  tile: Tile,
  footprint: number,
  walls: Set<number>,
): number {
  if (kind !== "wall") return 0;
  const strip = (tx: number, ty: number, alongX: boolean): boolean => {
    for (let i = 0; i < footprint; i++) {
      if (walls.has(tileKey({ tx: alongX ? tx + i : tx, ty: alongX ? ty : ty + i }))) return true;
    }
    return false;
  };
  const { tx, ty } = tile;
  return (
    (strip(tx, ty - 1, true) ? WALL_NORTH : 0) |
    (strip(tx + footprint, ty, false) ? WALL_EAST : 0) |
    (strip(tx, ty + footprint, true) ? WALL_SOUTH : 0) |
    (strip(tx - 1, ty, false) ? WALL_WEST : 0)
  );
}

function paintStructure(
  ctx: CanvasRenderingContext2D,
  kind: BuildableKind,
  tile: Tile,
  side: number,
  sprites: SpriteSource | undefined,
  blit: Blit,
  facing: number,
): void {
  const sprite = sprites?.(kind, facing, 0);
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
  blitOver: Blit,
): void {
  const sprite = sprites?.(enemy.kind, enemy.facing, enemy.frame);
  if (sprite) {
    // Centred, not foot-anchored, unlike everything else that stands up. A spider is the one
    // hybrid in the set: its body is upright but its legs splay *flat around* it, so the ring of
    // legs is its contact with the floor and that ring's centre is where the sim says it is.
    // Foot-anchoring it would hang the whole ring above `pos` and lift the body a full radius —
    // contact damage would land from a spider drawn half a body clear of you. The upright player
    // and the elevation structures are genuinely bottom-anchored and keep `blit`.
    blitOver(sprite, enemy.pos.x, enemy.pos.y);
  } else {
    ctx.fillStyle = ENEMY_COLORS[enemy.kind];
    fillCircle(ctx, enemy.pos.x, enemy.pos.y, enemy.radius);
  }
  const half = sprite ? sprite.size / 2 : enemy.radius;
  healthBar(
    ctx,
    enemy.pos.x,
    enemy.pos.y - half,
    enemy.radius * 2,
    enemy.hp,
    ENEMY_MAX_HP[enemy.kind],
  );
}

function paintAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: Avatar,
  isSelf: boolean,
  sprites: SpriteSource | undefined,
  blit: Blit,
  blitOver: Blit,
): void {
  const sprite = sprites?.("player", avatar.facing, avatar.frame);
  // Where the body actually is. A foot-anchored sprite stands *above* its position, so anything
  // that marks the avatar has to aim here and not at `pos`, which is now the ground under it.
  const bodyY = avatar.pos.y - (sprite ? sprite.size / 2 : 0);
  const halo = isSelf ? sprites?.("halo", 0, 0) : null;
  // Behind the avatar, so a glow reads as a glow around it rather than a veil over its face.
  if (halo) blitOver(halo, avatar.pos.x, bodyY);
  if (sprite) blit(sprite, avatar.pos.x, avatar.pos.y);
  else {
    ctx.fillStyle = SLOT_COLORS[(avatar.slot - 1) % SLOT_COLORS.length];
    fillCircle(ctx, avatar.pos.x, avatar.pos.y, avatar.radius);
  }
  if (isSelf && !halo) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    strokeCircle(ctx, avatar.pos.x, bodyY, avatar.radius + 3);
  }
}

// A player's bar and name, drawn in a pass of their own after every body has painted.
//
// The pass exists because of the halo. It is centred on the *body*, which a foot-anchored sprite
// puts half a sprite above `pos`, and it is nearly twice the player's width — so it reaches higher
// than the figure does and spills well outside it. Painted in the Y-sorted pass, a squadmate
// standing a little above you had their name land inside your ring, which reads as your own name
// against the one marker that is supposed to mean "this is you". Two things fix it and neither is
// enough alone: the offset has to clear the halo rather than the sprite, and no halo may paint
// after any label.
function paintOverhead(
  ctx: CanvasRenderingContext2D,
  avatar: Avatar,
  sprites: SpriteSource | undefined,
): void {
  const sprite = sprites?.("player", avatar.facing, avatar.frame);
  const halo = sprites?.("halo", 0, 0);
  const body = sprite ? sprite.size : avatar.radius * 2;
  // Every label clears the halo, not only your own: the one that reads wrong is a *neighbour's*.
  const reach = Math.max(body, (halo ? halo.size : 0) / 2 + body / 2);
  const top = avatar.pos.y - reach;
  // The bar rides above the drawing and the name above the bar. The band the bar occupies is
  // reserved whether or not one is showing, so a label does not hop as a player takes a hit.
  healthBar(ctx, avatar.pos.x, top, avatar.radius * 2, avatar.hp, PLAYER_MAX_HP);
  // The game's own typeface, as every other word in it is. This label is on ADR 0001's in-match
  // allowlist and is drawn here rather than in the DOM, so it was the one piece of text the M5 UI
  // restyle could not reach (#88 §4). The fallbacks match `styles.css`.
  ctx.font = '12px "Playfair Display", "Times New Roman", Times, serif';
  ctx.textAlign = "center";
  const baseline = top - BAR_GAP - BAR_HEIGHT - 3;
  // Cut out of the ink rather than laid on it. The floor is white paper and so is this stroke, so a
  // name over a black spider reads as a hole in the spider — which is how the period printed a
  // caption over artwork, and the only thing that keeps unoutlined black text legible over ink.
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = PAPER;
  ctx.strokeText(avatar.name, avatar.pos.x, baseline);
  ctx.fillStyle = INK;
  ctx.fillText(avatar.name, avatar.pos.x, baseline);
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
