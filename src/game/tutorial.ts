import type { BuildableKind, Tile, Vec2 } from "../lobby/protocol";
import type { SpriteName } from "../sprite/registry";
import {
  BULLET_COST,
  type BuildState,
  type OreGrid,
  oreUnder,
  solidAt,
  tileCenter,
  tileOf,
} from "./build";
import type { Camera, Viewport } from "./camera";
import { GUN_TOGGLE_KEY } from "./input";

// The mini-tutorial (#134): six prompts that teach a first-time player the game, and then never
// again. A state machine and nothing else — no React, no canvas and no clock — in the idiom
// `harvest.ts`, `floats.ts` and `damageFx.ts` already use: the caller feeds it what happened and
// what this frame looks like, and reads back what is on screen.
//
// Three things shape all of it, and they are the author's decisions rather than this module's:
//
// - **Nothing freezes.** A prompt is words on the screen and a mark on a thing. There is no gate
//   here, nothing returns "wait", and no caller is ever told to hold an input — which is why this
//   module has no way to express one.
// - **Per player, and private.** Every event below is something *this* client did. A teammate has
//   no route in: their turret, their first enemy and their mining raise nothing here, because
//   nothing on the wire reaches this module at all. The single exception is the shared Metal bank,
//   which prompt 2 rides because there is exactly one of it.
// - **Each prompt ends when its lesson lands.** Not one of them is on a timer. A prompt is *owed*
//   until the thing it teaches has been done; doing it is what takes it down, and what keeps it
//   down on this browser for good.

// How many Metal have to come out of the ground by this player's own hand before the metal tooltip
// drops to its short form. The ask's figure.
export const HAND_MINES_TAUGHT = 3;

// An inline icon in a sentence, or the words around it. The icon stands *beside* the noun it
// pictures rather than in place of it — "a ⟨generator icon⟩ generator" — so a sentence still reads
// as written where the art has not landed and the renderer simply draws nothing.
export type Say = string | { icon: SpriteName };

export const MINE_WORDS = "mine to get metal";
export const AMMO_WORDS = "Click to build ammo. You will need it!";
// One tooltip with two lengths: what a metal tile says while it is still teaching, and what it says
// once this player has dug three Metal out of one by hand.
export const METAL_WORDS = { taught: "Metal. Mine with left click", learned: "Metal" };
export const POWER_WORDS = "Power ore. Place a generator here to extract electricity";
export const TURRET_WORDS: readonly Say[] = [
  "Turrets require energy. Build a",
  { icon: "generator" },
  "generator on top of",
  { icon: "ore-power" },
  "power ore in order to generate electricity",
];
// Named off the binding rather than spelled out, so the sentence cannot go on naming a key the
// match no longer listens for. `input.ts` is the single authority on which key that is (#132).
export const GUN_WORDS = `Press ${GUN_TOGGLE_KEY.toUpperCase()} to equip/unequip your gun`;
export const SHOOT_WORDS = "Left click to shoot";

// What the tutorial teaches, one entry per prompt that can be finished with. Prompt 4 is absent and
// that is deliberate: the ask gives the power-ore tooltip no end but un-hovering, so it is not a
// lesson that lands — it is what a power tile says, for as long as the game is played.
export type Lesson =
  | "mine" // 1 — dig Metal out of the ground
  | "ammo" // 2 — turn Metal into a bullet
  | "hand" // 3 — three Metal by this player's own hand, which shortens the metal tooltip
  | "energy" // 5 — a generator, which is what a turret runs on
  | "gun" // 6 — the key that raises and stows the weapon
  | "shoot"; // 6 — and the button that fires it

const LESSONS: ReadonlySet<string> = new Set<Lesson>([
  "mine",
  "ammo",
  "hand",
  "energy",
  "gun",
  "shoot",
]);

// Something this client's own player did. Every one of them is raised where the game already knows
// it happened, so none of them can be raised by a teammate.
export type TutorialEvent =
  | { did: "mine" } // one whole Metal taken out of a tile by hand (#130's at-zero event)
  | { did: "forge" } // ordered a bullet
  | { did: "build"; kind: BuildableKind; tile: Tile }
  | { did: "equip" } // pressed the gun key
  | { did: "shoot" };

export interface Tutorial {
  learned: Set<Lesson>;
  handMined: number;
  // The first turret this player put up, until prompt 5 is done with it. A tile and not an id: the
  // server mints the id and the client places without waiting for it, so the footprint is the only
  // thing the placing client knows about its own turret at the moment it places it.
  turret: Tile | null;
  // And whether that turret has since been seen standing in the mirrored world. The client places
  // ahead of the server, so for a round trip after the press nothing occupies the tile — a prompt
  // that read occupancy straight would blink out on the frame it was raised and never come back.
  // The tile has to be seen filled before its emptying can mean anything.
  turretUp: boolean;
  // Latched frame facts. Both are one-way: a prompt raised by a passing condition must not blink
  // out when that condition passes — the bank being spent back under a bullet's price does not
  // un-teach ammo, and a wave being cleared does not un-teach the gun.
  banked: boolean;
  sighted: boolean;
}

export function freshTutorial(learned: Iterable<Lesson> = []): Tutorial {
  return {
    learned: new Set(learned),
    handMined: 0,
    turret: null,
    turretUp: false,
    banked: false,
    sighted: false,
  };
}

// What this frame looks like to the tutorial. Everything in it is something the render loop already
// holds, so feeding this costs the frame nothing it was not already paying for.
export interface TutorialScene {
  metal: number; // the shared bank
  enemies: number; // how many enemies this client is tracking
  ore: OreGrid;
  build: BuildState | null;
  self: Vec2 | null;
  camera: Camera;
  viewport: Viewport;
  cursor: Vec2 | null; // where the pointer is in the world, or null when it is off the arena
}

// The tutorial's world-anchored half: the marks and words the canvas draws, each moving with the
// camera because each is about a thing standing in the world.
export interface TutorialMarks {
  ore: { tile: Tile; words: string } | null; // 1
  cursor: { at: Vec2; words: string } | null; // 3 and 4
  turret: { tile: Tile; words: readonly Say[] } | null; // 5
}

// And the whole of it. `ammo` and `banner` are the screen-fixed half — one on the HUD's ammo box,
// one over the arena — so they are the DOM's and never reach `drawWorld`.
export interface TutorialView extends TutorialMarks {
  ammo: string | null; // 2
  banner: string | null; // 6
}

// Take in something the player did, and answer whether it landed a lesson — which is the caller's
// cue to write the tutorial down, and the only reason a caller ever needs to know.
//
// A lesson lands whether or not its prompt was up. Pressing the gun key before the first enemy ever
// appears is the plain case: the player has plainly learned it, so prompt 6 opens on the next one
// instead of teaching a key they are already using.
export function observe(tutorial: Tutorial, event: TutorialEvent): boolean {
  const before = tutorial.learned.size;
  switch (event.did) {
    case "mine":
      tutorial.learned.add("mine");
      tutorial.handMined++;
      if (tutorial.handMined >= HAND_MINES_TAUGHT) tutorial.learned.add("hand");
      break;
    case "forge":
      tutorial.learned.add("ammo");
      break;
    case "build":
      if (event.kind === "generator") {
        tutorial.learned.add("energy");
        tutorial.turret = null; // the lesson has landed; the turret it was raised over is free of it
      }
      // The *first* turret, and only while the lesson is still owed: a second one has nothing left
      // to say, and neither has the first once a generator is standing.
      else if (event.kind === "turret" && !tutorial.learned.has("energy") && !tutorial.turret) {
        tutorial.turret = { ...event.tile };
        tutorial.turretUp = false;
      }
      break;
    case "equip":
      tutorial.learned.add("gun");
      break;
    case "shoot":
      tutorial.learned.add("shoot");
      break;
  }
  return tutorial.learned.size !== before;
}

// What the tutorial has on screen this instant. A command as much as a query, like
// `ClientWorld.snapshot` and `stepMetalFloats`: the two latches above are set here, because the
// facts that set them are frame facts rather than events and there is nowhere else to see them.
export function stepTutorial(tutorial: Tutorial, scene: TutorialScene): TutorialView {
  if (scene.metal >= BULLET_COST) tutorial.banked = true;
  if (scene.enemies > 0) tutorial.sighted = true;
  // A turret pulled down or chewed apart takes its tooltip with it, rather than leaving a sentence
  // hanging over bare ground until a generator happens to go up — but only once it has been seen
  // standing, or the round trip its own placement takes would read as it never having been there.
  if (tutorial.turret && scene.build) {
    if (solidAt(scene.build, tutorial.turret)) tutorial.turretUp = true;
    else if (tutorial.turretUp) tutorial.turret = null;
  }
  return {
    ore: tutorial.learned.has("mine") ? null : markOre(scene),
    cursor: hoverWords(tutorial, scene),
    turret: tutorial.turret ? { tile: tutorial.turret, words: TURRET_WORDS } : null,
    ammo: tutorial.banked && !tutorial.learned.has("ammo") ? AMMO_WORDS : null,
    banner: banner(tutorial),
  };
}

// The metal ore to mark: the one nearest the player, out of the tiles the camera can actually see.
//
// Bounded to the viewport rather than searched over the grid, for the reason every floor pass in
// `draw.ts` is: a 2,080² tile world must cost what an 800 px one does. It also settles what would
// otherwise be the mark's worst failure — a highlight on the nearest ore in the *arena* is a
// highlight the player cannot see, which teaches nothing at all.
function markOre(scene: TutorialScene): { tile: Tile; words: string } | null {
  const { camera, viewport, ore, build, self } = scene;
  const from = self ?? { x: camera.x + viewport.width / 2, y: camera.y + viewport.height / 2 };
  const first = tileOf({ x: camera.x, y: camera.y });
  const last = tileOf({ x: camera.x + viewport.width, y: camera.y + viewport.height });
  let nearest: Tile | null = null;
  let reach = Number.POSITIVE_INFINITY;
  for (let ty = Math.max(0, first.ty); ty <= last.ty; ty++) {
    for (let tx = Math.max(0, first.tx); tx <= last.tx; tx++) {
      const tile = { tx, ty };
      if (oreUnder(tile, ore, build) !== "metal") continue;
      const centre = tileCenter(tile);
      // Squared, because only the order matters and a root would be paid per tile.
      const away = (centre.x - from.x) ** 2 + (centre.y - from.y) ** 2;
      if (away >= reach) continue;
      reach = away;
      nearest = tile;
    }
  }
  return nearest === null ? null : { tile: nearest, words: MINE_WORDS };
}

// What the tile under the cursor says, or nothing. Both ore kinds answer here — which is exactly
// what `resolveHarvest` cannot do, since power ore has no hand-mine path and so is nothing to it.
function hoverWords(tutorial: Tutorial, scene: TutorialScene): TutorialMarks["cursor"] {
  if (!scene.cursor) return null;
  const kind = oreUnder(tileOf(scene.cursor), scene.ore, scene.build);
  if (kind === null) return null;
  if (kind === "power") return { at: scene.cursor, words: POWER_WORDS };
  return {
    at: scene.cursor,
    words: tutorial.learned.has("hand") ? METAL_WORDS.learned : METAL_WORDS.taught,
  };
}

// Prompt 6, which is two prompts in a row: the key, then the button it makes useful. Both wait on
// an enemy having appeared, so a player who took the gun out before the first wave opens straight
// on the second half rather than being told about a key they are already holding.
function banner(tutorial: Tutorial): string | null {
  if (!tutorial.sighted) return null;
  if (!tutorial.learned.has("gun")) return GUN_WORDS;
  return tutorial.learned.has("shoot") ? null : SHOOT_WORDS;
}

// --- Seen once ever, per browser -----------------------------------------------------------
// The one impure pair in this module, and the same best-effort guard `client.ts` puts round the
// lobby token: `localStorage` may not be there at all (privacy mode, SSR). Where it is not, this
// reads as a player who has learned nothing — the tutorial **shows**. Failing toward teaching is
// the whole point: a suppressed tutorial is invisible, and a repeated one is merely a nuisance.

const STORE_KEY = "tutorial:learned";

export function loadLessons(): Lesson[] {
  try {
    const written: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    // Filtered rather than trusted: this is a string a player can edit, and a value that is not a
    // lesson would otherwise sit in the set for the match suppressing nothing and matching nothing.
    return Array.isArray(written) ? written.filter(isLesson) : [];
  } catch {
    return [];
  }
}

export function saveLessons(tutorial: Tutorial): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...tutorial.learned]));
  } catch {}
}

function isLesson(value: unknown): value is Lesson {
  return typeof value === "string" && LESSONS.has(value);
}
