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
  packTile,
  EAST as TILE_EAST,
  NORTH as TILE_NORTH,
  SOUTH as TILE_SOUTH,
  WEST as TILE_WEST,
} from "../sprite/tiled";
import {
  BUILDABLES,
  footprintCenter,
  type OreGrid,
  oreAt,
  TILE,
  TURRET_CADENCE_MS,
  tileKey,
  tileOf,
} from "./build";
import { type Camera, isVisible, type Viewport } from "./camera";
import { HIT_FLASH_MS, type Mark, type ShotEvent } from "./clientWorld";
import { edgeMarker, MARKER_STROKE, markerPoints } from "./edgeMarker";
import { ELITE_HP, GRUNT_HP, RANGED_RANGE } from "./enemies";
import { FLOAT_MS, FLOAT_RISE, type MetalFloat } from "./floats";
import { BURST_REACH, inkPuff, PUFF_REACH, speedLines, starburst } from "./fx";
import {
  MINIMAP_COVERAGE_U,
  minimapWindow,
  oreCells,
  oreDensity,
  project,
  projectRect,
} from "./minimap";
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
// - **A shot line**, for your own shots, your squadmates' and your turrets' alike — broken into
//   speed lines since #114. It is the most expensive thing in the frame per unit, so its 100 ms
//   lifetime is a budget and not a look.
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

// How long the starburst at an impact stays up (#115). Exactly `HIT_FLASH_MS`, and derived rather
// than picked: #107 already turns the spider white for that long, off the same `EnemyHit` and judged
// on the same delayed clock, so the two are one event told in two channels. A burst that outlived
// the flash would split it into two, which is the stacking #78 asks to be read together rather than
// piled up — and the burst is legible over an ink spider only for as long as that spider is paper.
// Retuning `HIT_FLASH_MS` therefore moves the burst too, and stales every measured burst figure in
// `docs/frame-budget.md` — the concurrent count, its ink share and its cost all scale off this life.
// Re-run `bun run burst:ink` and the burst ladder in `bun run frame:budget` if it moves.
export const BURST_MS = HIT_FLASH_MS;

// How long the puff struck where an enemy died stays up (#116). **Provisional**, and unlike the
// burst above it is picked rather than derived: nothing else in the game is timed off a death, so
// there is no second channel for it to agree with. Longer than a hit flash on purpose — a death is
// the larger event and the puff is the only thing that says it happened — and short of
// `DEATH_RETENTION_MS`, which is what stops a mark being swept out from under a frame still
// drawing it. Retuning it stales the concurrent puff count and its cost in `docs/frame-budget.md`;
// re-run `bun run puff:ink` and the puff ladder in `bun run frame:budget` if it moves.
export const PUFF_MS = 180;

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
  // The squad's spendable bullets, mirrored from the server (#102). Only the turret train reads
  // it, and only to stop: a turret's shots are generated here rather than sent, so an empty pool
  // is the one refusal this layer has to know about to keep from drawing shots nobody took.
  ammo: number;
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
  // The `+1`s currently in the air (#99), accrued per miner by `stepMetalFloats`. Aged here, like
  // a shot line: the render layer owns how long one is up, and nothing about it rides the wire.
  floats?: readonly MetalFloat[];
  // Where shots have connected and the sprites have caught up (#115) — `ClientWorld.impactMarks`,
  // already aged to `BURST_MS`. Handed in rather than aged here, because the clock a burst is judged
  // on is the delayed one the spiders are drawn against and this layer has never seen that delay.
  bursts?: readonly Mark[];
  // Where enemies have died and their sprites have already gone (#116) — `ClientWorld.deathMarks`,
  // already aged to `PUFF_MS`. Handed in for the same reason the bursts are: the clock a puff is
  // judged on is that class's, and this layer has never seen it.
  puffs?: readonly Mark[];
  // Baked art, or nothing. Absent — in a test, or before the first sprite lands — every entity
  // falls back to its shape, which is what keeps this one draw path the only one.
  sprites?: SpriteSource;
  // Device pixels per CSS pixel, matching the `setTransform(dpr, …)` the caller paints through.
  // Blits are aligned to whole device pixels with it; nothing else here needs it.
  dpr?: number;
  // How much world the corner map is a window onto, in world units — the zoom level the player has
  // cycled to (#110). Client-local and never on the wire. Absent, the map is at the level it opens
  // at, which is what keeps every older test in this file an assertion about 1×.
  minimapCoverage?: number;
  // Wall-clock ms, injected rather than read, so this stays a pure function of its arguments (the
  // `stepBuild` idiom). Only the flashing overlays use it; without it they sit on their first frame.
  now?: number;
  // Which players the lobby roster says are actually at the keyboard, for the off-screen arrows
  // (#94). A render input and not a wire one: presence rides the lobby snapshot and has never been
  // part of `WorldSnapshot`, so it is handed in here rather than added to it.
  //
  // Absent, no arrow is drawn at all. A player inside the server's 45 s grace window still holds
  // their slot and still stands in `players` with their avatar frozen where they dropped, and there
  // is nothing in the snapshot that tells them apart from a teammate standing still — so without
  // the roster the only honest arrow is none (#75).
  connected?: ReadonlySet<PlayerId>;
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

// The game's own typeface, as every other word in it is — the fallbacks match `styles.css`. Shared
// by the two things ADR 0001 allows to be written in the world: a player's name and a miner's `+1`.
const WORLD_FONT = '12px "Playfair Display", "Times New Roman", Times, serif';
const FLOAT_TEXT = "+1"; // one whole Metal, stated literally — #99 asks for no other figure

// How thick every stroke of a shot is. Two logical px, so a strand survives being drawn diagonally
// at dpr 1. #81 asked for continuous ink shooter to target; #114 broke it into speed lines, which is
// what makes an instantaneous shot read as fast now that #80 has left it with nothing that travels.
// The weight is shared by the trail so the whole mark reads as one hand. Exported for
// `scripts/shot-ink.ts`, which cannot measure the mark's coverage against a width of its own.
export const SHOT_WIDTH = 2;

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

// The corner map's marks (#93), all of them fixed sizes rather than the world drawn smaller: at
// 1:39 a 15 u tile is 0.38 px, so a scaled drawing of anything would be sub-pixel mush. The plate's
// rule is 2 to match `--rule` in `styles.css`, because the map is one more of the HUD's boxes and a
// second border weight beside them would read as a different game.
const MAP_RULE = 2;
const MAP_DOT = 3; // a squad member, and a nest
const MAP_SELF_RING = 6; // your own ring, struck outside your dot as the world strikes it outside your body
const MAP_STRUCTURE = 3; // one building — a base is the blot forty of these make, not any one of them
// Most of a cell an ore mark is allowed to take. Held under the structure square so the two layers
// never draw the same mark: a base has to stay a solid blot against the ore's graduated scatter.
const MAP_ORE_FILL = 0.8;
// The thinnest the door may draw. It is drawn at its true projected size — 98 u is 2.5 px at 1× —
// and #110's wider levels take that below a pixel, where the one thing on the map worth walking to
// would fade out exactly as the squad zoomed out to look for it.
const MAP_DOOR_MIN = 2;

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
  // The teammates this frame draws an edge arrow for instead of a body (#94).
  const beyond: Avatar[] = [];

  for (const a of world.players) {
    // A dead player vanishes instantly — no corpse (#81). What replaced the M2 fade is the screen
    // darkening below, and it is the dying player's own view only: squadmates simply see you gone.
    if (a.hp <= 0) continue;
    // One cull, two outcomes. Asking it twice — once for the body, once for the arrow — is what
    // would let a player crossing the edge be drawn both ways or neither on the same frame.
    if (!isVisible(a.pos, a.radius * 2, camera, viewport, LABEL_PAD)) {
      if (a.id !== options.selfId && options.connected?.has(a.id)) beyond.push(a);
      continue;
    }
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

  // Straight after the lines, and over the sort for the same reason they are: a burst marks the
  // point a shot connected, and one sorted in behind the spider it belongs to would be hidden by the
  // very thing it is about.
  drawBursts(ctx, options);

  // And the puffs beside them (#116). Over the sort for a reason of its own: a puff stands in for a
  // body the frame no longer has, so sorting it among the ones that are left would bury it behind
  // whatever happens to be standing over the gap the dead spider left.
  drawPuffs(ctx, options);

  // The lettered word over both of them (#79), and over the sort for the same reason they are —
  // with one more of its own: it is the only mark in the frame that carries paper, so anything
  // sorted in front of it would be read as being *inside* the word.
  drawLettering(options, blitOver);

  // Over the sort for the same reason a shot line is: a `+1` marks the miner that earned it rather
  // than standing on the floor beside it, and one half-hidden behind a spider says nothing.
  drawFloats(ctx, options.floats, now);

  // Over the world for the same reason again: an arrow marks the edge of the screen rather than a
  // spot on the floor, so nothing standing near that edge may bury it.
  drawEdgeMarkers(ctx, beyond, camera, viewport);

  // Names last of everything in the world. They are on ADR 0001's short allowlist — almost nothing
  // else may be written on screen — so nothing the world draws is allowed to obscure one, the `+1`
  // included.
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

  // Over the world entire, because it is not in it: the map is a corner of the *screen*, drawn in
  // world coordinates only because that is the space this whole file paints in. Without a player
  // to centre on there is no window and nothing is drawn at all.
  const self = world.players.find((p) => p.id === options.selfId);
  if (self) drawMinimap(ctx, world, self, options);

  // Last of all, and only ever on the dying player's own screen. It falls over the map too — a
  // player who is down is out of the fight, and reading the arena is part of the fight.
  if (self && self.hp <= 0) {
    ctx.fillStyle = DOWNED_DIM;
    ctx.fillRect(camera.x, camera.y, viewport.width, viewport.height);
  }
}

// The frame's shots: your own, your squadmates' and your turrets' (#81), all struck the same way —
// the shot's own line with speed lines trailing it (#114), which `fx.ts` lays out.
//
// Aged here rather than upstream. `ClientWorld` keeps shots for `SHOT_RETENTION_MS` (250) as a
// memory bound, which is deliberately longer than any lifetime a caller might ask for; drawing
// everything it holds would put two and a half times the budgeted lines on screen.
//
// Turret shots have no per-shot event to age, because none is sent: a turret's `(target, powered)`
// pair is streamed as a transition, so the client generates the pulse train itself — one pulse
// every `TURRET_CADENCE_MS` for as long as that state holds, each lasting `SHOT_LINE_MS` (#74 §5).
// The generated phase can sit up to a cadence out of step with the server's real cooldown, which is
// invisible at 200 ms and cannot misrepresent damage: while the squad has bullets, the server is
// applying `TURRET_DAMAGE` on exactly that cadence for as long as that state holds.
//
// Ammo is the one firing precondition the transition does not carry, so the pool gates the train
// here instead — see `ShotSource.ammo` and the amendment to ADR 0003 (#102).
function drawShots(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  { shots, camera, viewport, now = 0 }: DrawOptions,
): void {
  if (!shots) return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = SHOT_WIDTH;

  const strike = (from: Vec2, to: Vec2): void => {
    // A shot can be long enough to cross the whole viewport, so it is culled on the box it spans
    // rather than on either end: a turret off the left edge firing at a nest off the right one is
    // still drawn across the middle of the screen. Spent before the mark is built, so a shot with
    // nothing of it on screen costs no geometry at all.
    if (Math.max(from.x, to.x) < camera.x || Math.min(from.x, to.x) > camera.x + viewport.width) {
      return;
    }
    if (Math.max(from.y, to.y) < camera.y || Math.min(from.y, to.y) > camera.y + viewport.height) {
      return;
    }
    // One path for the whole mark, so a shot still costs the frame the single stroke
    // `docs/frame-budget.md` prices it at — the trail and the breaks are more geometry, not more
    // paths. The break is struck as segments rather than left to `setLineDash`, which measured
    // dearer for the identical pattern (5.55 ms against 4.88 at 50 shots, dpr 2) and would leave a
    // dash in force over every name, arrow and map rule drawn after it.
    ctx.beginPath();
    for (const strand of speedLines(from, to)) {
      ctx.moveTo(strand.from.x, strand.from.y);
      ctx.lineTo(strand.to.x, strand.to.y);
    }
    ctx.stroke();
  };

  if (shots.own && now - shots.own.at < SHOT_LINE_MS) {
    strike(shots.own.from, reach(shots.own.from, shots.own.dir));
  }

  for (const { shot, at } of shots.peers) {
    if (now - at >= SHOT_LINE_MS) continue;
    // The origin is not on the wire: the shooter's own rendered position is already within a
    // player-diameter of where the server saw it (#74 §3). A peer who has since left has none.
    const from = world.players.find((p) => p.id === shot.id)?.pos;
    if (!from) continue;
    // A ray that hit nothing still draws, out to full range — a squadmate firing into empty air
    // with no line looks broken (#74 §6). A ray that hit something the client cannot resolve draws
    // nothing at all: that is the death window, and it is the one case a mark would be a lie.
    const to = shot.hit === undefined ? reach(from, shot.dir) : shots.resolve(shot.hit);
    if (to) strike(from, to);
  }

  drawTurretTrains(world, shots, now, strike);
}

// The turret pulses this frame, handed the same strike the other two shooters get.
//
// Turrets spend the squad's bullets, so the pool bounds how many of them can have fired: an empty
// one is the server holding every turret's fire, and one bullet across five ready turrets is four
// trains nobody took. The mirror lags the pool by at most one tick, which under-draws (a bullet
// forged and fired on the same tick never shows as spendable) rather than over-draws — the
// direction ADR 0003 cares about.
//
// *Which* turret got a scarce bullet is not knowable here and is not claimed: the pool is spent
// down `world.structures`, which is a map's insertion order and so names the same winners frame
// after frame. A rule that reshuffled — nearest, or newest — would flicker the train between
// turrets while the count stayed right, which is worse to look at than being wrong about one.
// Spent before the cull for the same reason: a bullet goes to a turret that fired, not to one the
// camera happens to be pointing at, so panning cannot hand it to somebody else.
function drawTurretTrains(
  world: WorldSnapshot,
  shots: ShotSource,
  now: number,
  strike: (from: Vec2, to: Vec2) => void,
): void {
  if (now % TURRET_CADENCE_MS >= SHOT_LINE_MS) return;
  let spent = 0;
  for (const s of world.structures) {
    if (spent >= shots.ammo) return;
    if (!s.turret?.powered || s.turret.targetId === null) continue;
    const spec = BUILDABLES[s.kind];
    const to = spec && shots.resolve(s.turret.targetId);
    if (!to) continue;
    spent++;
    strike(footprintCenter(s.tile, spec.footprint), to);
  }
}

// The starbursts this frame strikes, one where each shot connected (#115).
//
// **One path for every burst in the frame, not one per burst.** A shot is charged per stroke rather
// than per inked pixel (`docs/frame-budget.md` rule 1), and this is the effect most exposed to that:
// it fires on every connect rather than on every death, so a per-burst path would put the count of
// paths on the hit rate. Bundled, the frame pays for the spikes and one stroke however many bursts
// are up.
//
// Struck in the same ink at the same width as the shot that caused it — one pen for the whole event.
//
// Nothing is aged here. `ClientWorld.impactMarks` has already withheld every mark whose sprite has
// not reached it and dropped every mark whose life has run out, because the clock that decides both
// is the delayed one the spiders render on and this layer does not have it.
function drawBursts(
  ctx: CanvasRenderingContext2D,
  { bursts, camera, viewport }: DrawOptions,
): void {
  if (!bursts || bursts.length === 0) return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = SHOT_WIDTH;
  ctx.beginPath();
  let struck = 0;
  for (const mark of bursts) {
    // Hits stream for the whole arena rather than for the part of it the camera is over, so most
    // marks in a wave belong to a fight nobody is watching. Culled before the geometry is built, so
    // one of those costs no strokes rather than a bundle that is thrown away (rule 3).
    if (!isVisible(mark.pos, BURST_REACH, camera, viewport)) continue;
    for (const spike of starburst(mark.pos)) {
      ctx.moveTo(spike.from.x, spike.from.y);
      ctx.lineTo(spike.to.x, spike.to.y);
    }
    struck++;
  }
  if (struck > 0) ctx.stroke();
}

// The ink puffs this frame strikes, one where each enemy died (#116).
//
// Bundled into one path like the bursts: a wave clear is dozens of deaths on a single tick, and the
// count of paths is the one thing about the mark that must not ride that. Bundling buys nothing on
// the clock — #115 measured that — and it is done for the same reason it was there.
//
// **The dearest mark in the frame per unit, and its six arcs are why.** A puff costs twice a burst
// and 1.4 times a shot line at the same count while laying a sixth of a shot's ink, because
// `ctx.arc` is not one piece: the rasteriser flattens a swept arc into as many segments as it needs.
// `docs/frame-budget.md` rule 1 counts pieces and gets this mark wrong; the lobe count is the lever.
//
// Each puff is its own subpath — opened with a `moveTo` at the first lobe's start and closed at the
// end — because `fx.ts` hands back lobes that already chain end to end. Struck that way the scallops
// join; opened per lobe instead they would be six arcs meeting at butt ends, with a notch at each
// seam. `ctx.arc` draws the line into its own start itself, so nothing between them is needed.
//
// Struck in the same ink at the same width as the shot that killed it — one pen for the whole event.
//
// Nothing is aged here. `ClientWorld.deathMarks` has already dropped every mark whose life has run
// out, and it is the one that knows the enemy render delay this mark's position was taken on.
function drawPuffs(ctx: CanvasRenderingContext2D, { puffs, camera, viewport }: DrawOptions): void {
  if (!puffs || puffs.length === 0) return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = SHOT_WIDTH;
  ctx.beginPath();
  let struck = 0;
  for (const mark of puffs) {
    // Deaths stream for the whole arena rather than for the part of it the camera is over, so most
    // of a wave's puffs belong to a fight nobody is watching. Culled before the geometry is built,
    // so one of those costs no arcs rather than a cloud that is thrown away (rule 3).
    if (!isVisible(mark.pos, PUFF_REACH, camera, viewport)) continue;
    const lobes = inkPuff(mark.pos);
    ctx.moveTo(
      lobes[0].at.x + Math.cos(lobes[0].from) * lobes[0].radius,
      lobes[0].at.y + Math.sin(lobes[0].from) * lobes[0].radius,
    );
    for (const lobe of lobes) ctx.arc(lobe.at.x, lobe.at.y, lobe.radius, lobe.from, lobe.to);
    ctx.closePath();
    struck++;
  }
  if (struck > 0) ctx.stroke();
}

// Which word a mark is lettered with (#79) — a non-negative integer, wrapped by the sprite cache
// into however many words `src/sprite/lettering.ts` actually draws.
//
// **That wrap is the whole interface, and it is why this returns an index rather than a word.** The
// render layer never learns how large the set is, so adding a word or dropping one is a change to
// one sprite module and to nothing else — the same property `oreVariant` has, where the packing
// lives beside the sprite that unpacks it. `SpriteSource` does not expose a subject's facing count
// and does not need to.
//
// Derived from the mark and nothing else, which is what makes it *stable*: a word chosen per frame
// would cycle the whole set over its own lifetime, and the position is what tells two marks on the
// same tick apart — every hit in one delta shares an `at` (`ClientWorld.applyMapDelta`). Pure
// arithmetic, the same mix `tileVariant` scatters the grass with, so it costs no state and every
// client letters the same blow the same way.
export function letteringAt(pos: Vec2, at: number): number {
  const mixed = Math.imul(
    (Math.round(pos.x) * 73_856_093) ^ (Math.round(pos.y) * 19_349_663) ^ (at * 83_492_791),
    0x45d9f3b,
  );
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

// The words this frame pops, one over every hit and every death the two mark lists hold (#79).
//
// **It rides #115's and #116's marks rather than a list of its own, and that is what times it.** A
// hit arrives on the 20 Hz tick while the spider it belongs to is `ENEMY_RENDER_DELAY_MS` behind,
// so a word stamped against the event would pop before the drawing it is about; `impactMarks` has
// already held every mark back until its sprite caught up, and `deathMarks` has already applied the
// same delay to a dead spider's *position*. Nothing about that clock is visible from here, and this
// layer is better off never seeing it.
//
// It also means the word's lifetime is the mark's lifetime — `BURST_MS` on a hit, `PUFF_MS` on a
// death — rather than a third number nobody could hold the other two against.
//
// **One blit a word, and no fallback.** Every other entity in this file keeps the shape it drew
// before its sprite landed; a word has no shape, and the only shape it could fall back to is
// `fillText`, which is exactly what ADR 0001's grant for this does *not* cover. Without the art the
// layer draws nothing at all, and `drawWorld` stays the one draw path it has always been.
function drawLettering(
  { bursts, puffs, camera, viewport, sprites }: DrawOptions,
  blitOver: Blit,
): void {
  // One lookup for the whole layer, and the box every word shares: without the art there is nothing
  // to draw, and the cull below needs a reach before it can ask for a second sprite.
  const probe = sprites?.("lettering", 0, 0);
  if (!probe) return;
  const source = sprites as SpriteSource;
  for (const marks of [bursts, puffs]) {
    for (const mark of marks ?? []) {
      // Hits and deaths stream for the whole arena rather than for the part of it the camera is
      // over, so most of a wave's words belong to a fight nobody is watching (rule 3).
      if (!isVisible(mark.pos, probe.size / 2, camera, viewport)) continue;
      const word = source("lettering", letteringAt(mark.pos, mark.at), 0);
      if (word) blitOver(word, mark.pos.x, mark.pos.y);
    }
  }
}

// The `+1`s a miner throws up as it mines (#99). Each one is literally one whole Metal — never a
// batched total — so the figure never changes and the only things that age are its height and its
// opacity. Cut out of paper exactly as a name is, and for the same reason: the floor is white and
// the sprites are solid ink, so unoutlined black over a spider is invisible.
function drawFloats(
  ctx: CanvasRenderingContext2D,
  floats: readonly MetalFloat[] | undefined,
  now: number,
): void {
  if (!floats || floats.length === 0) return;
  ctx.font = WORLD_FONT;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  for (const float of floats) {
    const life = (now - float.at) / FLOAT_MS;
    if (life < 0 || life >= 1) continue;
    ctx.globalAlpha = 1 - life;
    const y = float.pos.y - life * FLOAT_RISE;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(FLOAT_TEXT, float.pos.x, y);
    ctx.fillStyle = INK;
    ctx.fillText(FLOAT_TEXT, float.pos.x, y);
  }
  ctx.globalAlpha = 1;
}

// A small arrow at the viewport edge for each teammate the camera has left behind (#94), pointing
// at where the snapshot renders them — which for a peer is already the interpolated, render-delayed
// sample (`ClientWorld.render`), so the arrow and the sprite are aimed by the same number and cannot
// disagree on the frame one becomes the other.
//
// Slot colour inside an ink outline. The colour is the only identity channel ADR 0001 leaves open,
// and the outline is there for the reason the health bar's ink frame is: the slot colours were
// picked to tell six players apart, not to carry on white paper — four of the six are under 3:1
// against it at full opacity, #f2c14e at 1.68 — so the outline is what the drawing is read by over
// the floor, and the
// fill is what it is read by over the ink of a wall or a spider.
//
// Painted per frame rather than baked. A bake is keyed by what it was drawn from and this one's
// bearing is continuous, so caching it means quantising the rotation — which either steps visibly as
// a teammate walks or holds a bake per degree per slot. Five four-point paths do not earn that.
function drawEdgeMarkers(
  ctx: CanvasRenderingContext2D,
  peers: readonly Avatar[],
  camera: Camera,
  viewport: Viewport,
): void {
  if (peers.length === 0) return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = MARKER_STROKE;
  ctx.lineJoin = "round";
  for (const peer of peers) {
    const marker = edgeMarker(peer.pos, camera, viewport);
    const points = markerPoints(marker);
    ctx.globalAlpha = marker.alpha;
    ctx.fillStyle = SLOT_COLORS[(peer.slot - 1) % SLOT_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// The corner map (#93): the squad, the nests, the ore as density, the base, and the door once the
// squad has found it. **No enemy, at any count** — the arena is read for where things are, not for
// what is coming — and no word anywhere on it, which ADR 0001 settles by not granting the map a
// line in its allowlist.
//
// Every decision about *where* is `minimap.ts`'s, and this is only the ink. That split is what
// keeps the layers below thin enough to read as a list of marks: a projection that answers null
// outside the window is what makes "a revealed door 14,352 u out is simply not on your map" a
// property of the geometry rather than a check repeated in five painters.
//
// Cheap for the reason the health bars are (`docs/frame-budget.md`): almost all of it is
// axis-aligned fills on a 200 px square, and the ore — the only layer whose size the world sets —
// is read out of a field derived once instead of aggregated per frame.
//
// The zoom level (#110) reaches this as one number and changes nothing else. Every mark below is a
// fixed size on the plate, so a wider level shows more world at the same legibility rather than the
// same map printed smaller, and only the ore square and the door bar — the two things drawn at
// their true projected size — grow and shrink with it.
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: WorldSnapshot,
  self: Avatar,
  { camera, viewport, dpr = 1, minimapCoverage = MINIMAP_COVERAGE_U }: DrawOptions,
): void {
  const placed = minimapWindow(self.pos, camera, viewport, minimapCoverage);
  // The plate's own corner has to land on a device pixel or its rule — the hard edge that stops it
  // dissolving into the white floor — comes out soft. Snapped here and not in `minimap.ts`, which
  // is deliberately free of the device ratio; every mark is projected off this origin, so moving it
  // moves the whole map together and the projection stays exact.
  const win = {
    ...placed,
    x: snap(placed.x, camera.x, dpr),
    y: snap(placed.y, camera.y, dpr),
  };

  ctx.fillStyle = PAPER;
  ctx.fillRect(win.x, win.y, win.size, win.size);

  // Nothing may reach past the plate. A mark has a size the projection knows nothing about — a dot
  // reaches MAP_DOT past wherever its centre landed — so a squadmate at the very edge of the window would
  // otherwise spill onto the floor outside the map.
  ctx.save();
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.size, win.size);
  ctx.clip();

  ctx.fillStyle = INK;
  for (const cell of oreCells(win, oreDensity(world.ore, world.arena))) {
    // Ink *area* proportional to the share of the cell that is ore, which is what makes the mark
    // the density rather than a marker standing beside it. It is also the period's own answer to a
    // palette with no greys in it (#72): a graduated stipple is how a 1930s plate prints a tone.
    const side = cell.size * MAP_ORE_FILL * Math.sqrt(cell.density);
    ctx.fillRect(cell.x + (cell.size - side) / 2, cell.y + (cell.size - side) / 2, side, side);
  }

  // Every structure, because every structure is the squad's: the bank is communal and a building
  // carries no owner (`build.ts`). "Where the base is" is what forty of these in one place says.
  for (const s of world.structures) {
    const spec = BUILDABLES[s.kind];
    if (!spec) continue;
    const at = project(win, footprintCenter(s.tile, spec.footprint));
    if (!at) continue;
    ctx.fillRect(at.x - MAP_STRUCTURE / 2, at.y - MAP_STRUCTURE / 2, MAP_STRUCTURE, MAP_STRUCTURE);
  }

  // The door, at its true projected size, so it is the bar set into the wall rather than a symbol
  // for one — and nothing at all until the squad has been near enough to find it.
  if (world.exitRevealed) {
    const door = projectRect(win, world.exit);
    if (door) {
      ctx.fillRect(
        door.x,
        door.y,
        Math.max(door.width, MAP_DOOR_MIN),
        Math.max(door.height, MAP_DOOR_MIN),
      );
    }
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  // Nothing here knows how many nests there are or where they were laid out, which is what let #123
  // land without touching this: fifty at random read exactly as eight on a ring did.
  for (const nest of world.nests) {
    const at = project(win, nest.pos);
    if (!at) continue;
    // Filled against hollow, not two colours. At 6 u across, `NEST` and `NEST_DEAD` are the same
    // dark dot, and a state has to survive being printed the size of a full stop.
    ctx.fillStyle = nest.alive ? NEST : PAPER;
    fillCircle(ctx, at.x, at.y, MAP_DOT);
    strokeCircle(ctx, at.x, at.y, MAP_DOT);
  }

  for (const player of world.players) {
    if (player.hp <= 0) continue; // no corpse on the map either (#81)
    const at = project(win, player.pos);
    if (!at) continue;
    // Slot colour inside an ink outline, exactly as an edge arrow is drawn and for the same reason:
    // four of the six colours are under 3:1 against paper, so the outline is what the mark is read
    // by and the fill is what it is told apart by.
    ctx.fillStyle = SLOT_COLORS[(player.slot - 1) % SLOT_COLORS.length];
    fillCircle(ctx, at.x, at.y, MAP_DOT);
    strokeCircle(ctx, at.x, at.y, MAP_DOT);
    if (player.id === self.id) strokeCircle(ctx, at.x, at.y, MAP_SELF_RING);
  }

  ctx.restore();

  // The rule last, over everything the clip let through, so the plate's edge stays the hard line
  // the rest of the HUD is boxed in rather than whatever happened to run into it.
  ctx.lineWidth = MAP_RULE;
  ctx.strokeStyle = INK;
  ctx.strokeRect(win.x, win.y, win.size, win.size);
}

// Where a shot that hit nothing ends: full range along the aim vector, which the server admitted as
// a unit vector. Never clipped shorter, and #114's trail now depends on that as well as ADR 0003 §3
// does: the strands close onto the line 28–70 u short of the head at full reach, so an own line that
// stopped on a target would close them onto it and make the bundle read as the hit marker the ADR
// forbids. Pinned in `draw.test.ts`, "your own shot's trail closes clear of anything standing at its
// head".
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
        const sprite = sprites(ORE_SPRITES[kind], oreVariant(world.ore, tx, ty, kind), 0);
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

// Which of a tile's four sides have the same ore beyond them, packed with the tile's cell into the
// one variant index a sprite is handed. This is the fact a tiled sprite cannot derive and cannot
// do without (#87): a patch has to be *seamless inside* — ink crossing every interior seam, or a
// white lattice forms on the grid pitch — and *ragged at its edge* — ink held back, or the deposit
// ends in hard axis-aligned steps. Those are opposite instructions for the same four edges, and
// only occupancy tells them apart. The packing itself lives in `sprite/tiled.ts`, beside the
// sprites that unpack it.
export function oreVariant(ore: OreGrid, tx: number, ty: number, kind: OreKind): number {
  const same = (x: number, y: number) => (oreAt(ore, { tx: x, ty: y }) === kind ? 1 : 0);
  const mask =
    same(tx, ty - 1) * TILE_NORTH +
    same(tx + 1, ty) * TILE_EAST +
    same(tx, ty + 1) * TILE_SOUTH +
    same(tx - 1, ty) * TILE_WEST;
  return packTile(mask, tx, ty);
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
// none — despite a nest being the longest single fight in the game, and the one readout with real
// tactical weight, since killing one is how the pressure around it drops (#88 §2).
//
// Scaled against the nest's own `maxHp`, not a constant: since #123 an outer nest is worth four
// times an inner one, so a shared ceiling would draw an inner nest as permanently near-dead.
//
// A silenced nest is skipped rather than shown empty: it is wreckage, not a fight in progress, and
// the destroyed sprite already says so.
function paintNestHealth(ctx: CanvasRenderingContext2D, nest: RenderedNest): void {
  if (!nest.alive) return;
  healthBar(ctx, nest.pos.x, nest.pos.y - nest.radius, nest.radius * 2, nest.hp, nest.maxHp);
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
    // Freshly hit, a spider wears the inverted variant of this same bake (#107) — paper where its
    // ink was, with a rim of ink standing, because the floor is white paper and a solid white spider
    // would be an invisible one. It is one blit like any other: the variant is derived once and
    // cached, never composited into the frame.
    const flash = enemy.flashing ? sprites?.(enemy.kind, enemy.facing, enemy.frame, "flash") : null;
    // Centred, not foot-anchored, unlike everything else that stands up. A spider is the one
    // hybrid in the set: its body is upright but its legs splay *flat around* it, so the ring of
    // legs is its contact with the floor and that ring's centre is where the sim says it is.
    // Foot-anchoring it would hang the whole ring above `pos` and lift the body a full radius —
    // contact damage would land from a spider drawn half a body clear of you. The upright player
    // and the elevation structures are genuinely bottom-anchored and keep `blit`.
    blitOver(flash ?? sprite, enemy.pos.x, enemy.pos.y);
  } else {
    ctx.fillStyle = ENEMY_COLORS[enemy.kind];
    fillCircle(ctx, enemy.pos.x, enemy.pos.y, enemy.radius);
  }
  // Off the plain box at every moment, flashing or not, so the bar does not hop a px each time the
  // flash's slightly wider box comes and goes.
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
  // On ADR 0001's in-match allowlist, and drawn here rather than in the DOM, so it was the one piece
  // of text the M5 UI restyle could not reach (#88 §4).
  ctx.font = WORLD_FONT;
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
