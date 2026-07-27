import { BUILDABLES, TILE } from "../game/build";
import { ELITE_RADIUS, GRUNT_RADIUS, NEST_RADIUS } from "../game/enemies";
import { PLAYER_RADIUS } from "../game/world";
import type { BuildableKind } from "../lobby/protocol";
import ammo from "./ammo";
import elite from "./elite";
import generator from "./generator";
import grass from "./grass";
import grunt from "./grunt";
import halo from "./halo";
import miner from "./miner";
import nest from "./nest";
import oreMetal from "./ore-metal";
import orePower from "./ore-power";
import player from "./player";
import reconnecting from "./reconnecting";
import room from "./room";
import type { SpriteSubject } from "./sheet";
import turret from "./turret";
import unpowered from "./unpowered";
import wall from "./wall";
import warning from "./warning";

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
  | "ammo" // HUD: the squad's forged bullets
  | "warning" // HUD: a structure is under attack
  | "reconnecting" // HUD: the socket dropped and the client is trying to get back in
  | "unpowered"; // in-world: a turret with no energy

// The box a sprite draws in, in CSS px — which is also world units, since the zoom is 1:1.
// Every entry is *derived* from the size the entity already is in the simulation, so the art and
// the thing it stands for can never drift apart. #81 quotes these same numbers.
//
// The names left out have no size fixed by #81: `grass`'s tuft is #72's to settle along with its
// density, and `halo`, `warning` and `unpowered` are overlays whose box is their own agent's call.
// Inventing numbers for them here would be deciding by accident.
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
  // The perimeter is tiled from one square, so the band's width is also the run's step. Two tiles
  // divides the arena exactly (31,200 / 30 = 1,040 segments a side) and matches a wall building.
  room: TILE * 2, // 30
  // Settled by #72 alongside the density, because neither number means anything without the other:
  // the same scatter reads as decoration at one size and as undergrowth at the next one up. Ten is
  // the smallest box whose blades still resolve on a non-retina display, and at 10 against the
  // player's 28 the tuft stays plainly something the player walks over rather than through.
  grass: 10,
};

// The sprites that have actually landed. Wiring one in is two lines — an import above, and a name
// here. A module sitting in this directory without an entry is a sprite nobody can see, so
// `registry.test.ts` fails on one rather than letting it pass for art that has not landed yet.
export const SPRITES: Partial<Record<SpriteName, SpriteSubject>> = {
  ammo,
  grass,
  elite,
  generator,
  grunt,
  halo,
  miner,
  nest,
  "ore-metal": oreMetal,
  "ore-power": orePower,
  player,
  reconnecting,
  room,
  turret,
  unpowered,
  wall,
  warning,
};

function footprintBox(kind: BuildableKind): number | undefined {
  const spec = BUILDABLES[kind];
  return spec && spec.footprint * TILE;
}
