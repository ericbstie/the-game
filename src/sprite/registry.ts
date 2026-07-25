import { BUILDABLES, TILE } from "../game/build";
import { ELITE_RADIUS, GRUNT_RADIUS, NEST_RADIUS } from "../game/enemies";
import { PLAYER_RADIUS } from "../game/world";
import type { BuildableKind } from "../lobby/protocol";
import type { SpriteSubject } from "./sheet";

// Every sprite the game draws, and the module that draws it.
//
// One agent per sprite (ADR 0002), one file each — `src/sprite/<name>.ts`, default-exporting a
// SpriteSubject. This table is the *only* place a produced sprite is wired in, and sprite agents
// never edit it: a dozen of them work in parallel without ever meeting in this file. Landing a
// sprite is an import plus one line, done when its file is merged.
//
// A name with no subject falls back to the coloured circle or rectangle the game has drawn since
// M2, so the game keeps running and the suite keeps passing while sprites arrive one at a time.
// See README.md in this directory for the contract each of those files is written against.

export type SpriteName =
  | "player"
  | "grunt"
  | "elite"
  | "nest" // the egg sac: facing 0 intact, facing 1 destroyed
  | "miner"
  | "wall"
  | "turret"
  | "generator"
  | "ore-metal"
  | "ore-power"
  | "grass"
  | "room" // the perimeter wall unfolded outward, and the escape door
  | "halo" // the barely-yellow self marker
  | "warning" // HUD: a structure is under attack
  | "unpowered"; // in-world: a turret with no energy

// The box a sprite draws in, in CSS px — which is also world units, since the zoom is 1:1.
// Every entry is *derived* from the size the entity already is in the simulation, so the art and
// the thing it stands for can never drift apart. #81 quotes these same numbers.
//
// The names left out have no size fixed by #81: `grass` and `room` are #72's and the room-wall
// ticket's to settle, and `halo`, `warning` and `unpowered` are overlays whose box is their own
// agent's call. Inventing numbers for them here would be deciding by accident.
export const SPRITE_BOX: Partial<Record<SpriteName, number>> = {
  player: PLAYER_RADIUS * 2, // 28
  grunt: GRUNT_RADIUS * 2, // 32
  elite: ELITE_RADIUS * 2, // 48
  nest: NEST_RADIUS * 2, // 96
  miner: footprintBox("miner"), // 30
  wall: footprintBox("wall"), // 30
  turret: footprintBox("turret"), // 30
  generator: footprintBox("generator"), // 75
  "ore-metal": TILE, // 15
  "ore-power": TILE, // 15
};

// The sprites that have actually landed. Empty until the first agent's file is merged; wiring one
// in is two lines — `import player from "./player";` above, and `player,` here.
export const SPRITES: Partial<Record<SpriteName, SpriteSubject>> = {};

function footprintBox(kind: BuildableKind): number | undefined {
  const spec = BUILDABLES[kind];
  return spec && spec.footprint * TILE;
}
