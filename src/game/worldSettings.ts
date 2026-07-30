import type { Arena } from "../lobby/protocol";

// The knobs a world is built and simulated from (#127): one object, threaded through
// `generateWorld`, `generateOre` and the enemy sim, in place of the private module constants each
// of them used to read. The host chooses them and the server is the sole authority on them (#128);
// `DEFAULT_WORLD_SETTINGS` is exactly the world the game ships with, and what a squad plays until
// someone moves a knob. Letting them move it in the lobby is #129.
//
// Its own module rather than a corner of `world.ts` because it is the one shape all three
// generators and both sides of the wire share, the way `protocol.ts` is — and because a settings
// object in `world.ts` would make that module name the enemy sim's knobs, which #93 deliberately
// keeps it from doing.
//
// This module also owns what a *legal* set of knobs is (`parseWorldSettings`, below), because the
// rules are facts about the knobs rather than about the wire.
//
// Every number here is **provisional** balance (#123/#124/#125): a later change to one is a
// retune, not a correction.
export interface WorldSettings {
  // One giant box: ~2 minutes to walk end-to-end at PLAYER_SPEED (≈60 s centre → perimeter).
  arena: Arena;
  // Ore density. Power ore is smaller and sparser than metal, per the spec.
  metalPatches: number;
  powerPatches: number;
  // Ore distribution: the radial fraction of a patch centre is drawn as u ** (1 / oreEdgeBias), so
  // areal density grows toward the wall instead of thinning as the rings get longer.
  oreEdgeBias: number;
  nestCount: number;
  // The nests' own bias, deliberately not the ore's (`docs/adr/0005`). The same curve at the same
  // 3.5 today, but sampled over the nest band rather than the whole arena, and a retune of ore
  // generation must not move all fifty nests.
  nestEdgeBias: number;
  // Hard concurrency governor; a nest holds its remainder at the cap. It binds within a couple of
  // minutes of the wave-size cap, so from mid-match on it is this — not the curves below — that
  // sets how full the arena feels. It also governs frame cost, and is the one knob a measurement
  // rather than a played match can veto: `docs/frame-budget.md` and `docs/map-delta-budget.md` are
  // both characterised at 500.
  enemyCap: number;
  // The three escalation curves (#124), each anchored at the end of the spawn grace. How long a
  // nest waits between waves, how many enemies a wave carries, and how many of them are elites.
  nestPeriod: { startMs: number; fallMs: number; floorMs: number };
  waveSize: { start: number; growth: number; max: number };
  eliteShare: { ptsPerMin: number; max: number }; // whole percentage points per minute, and a share
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  arena: { width: 31_200, height: 31_200 },
  metalPatches: 140,
  powerPatches: 40,
  oreEdgeBias: 3.5,
  nestCount: 50,
  nestEdgeBias: 3.5,
  enemyCap: 500,
  nestPeriod: { startMs: 60_000, fallMs: 5_000, floorMs: 10_000 },
  waveSize: { start: 1, growth: 1, max: 5 },
  eliteShare: { ptsPerMin: 5, max: 0.3 },
};

// Which knobs are strictly positive rather than merely non-negative: each is divided by or
// inverted, so a zero is not a small world but a `NaN` one. `arena.width / 2` places every patch
// and every nest; a bias is used as `u ** (1 / bias)`.
const POSITIVE = new Set(["arena.width", "arena.height", "oreEdgeBias", "nestEdgeBias"]);

// And which mean "make N of these", so a hostile figure is unbounded work for the server *and* for
// every client that has to expand the same seeds. Nothing else needs a ceiling: a wave is held by
// `enemyCap` (`enemies.ts` breaks the spawn loop at it) and a longer period is less work, not more.
const COUNTS = new Set(["metalPatches", "powerPatches", "nestCount", "enemyCap"]);

// How far past the shipped value one of those counts may be asked for. **Provisional**, and a
// safety bound rather than a balance one: #96 already says a squad may raise the enemy cap and
// spend its own frame budget, so this exists only to keep generation and the tick finite — not to
// keep a world sensible. #129's controls will offer a much narrower range inside it.
const MAX_MULTIPLE = 100;

// Narrow an untrusted settings payload, or refuse it whole (#128).
//
// Refuse, never clamp. A clamped knob is a world the host did not choose and cannot see they did
// not choose; a refusal leaves the session exactly as it was and reaches the sender as the
// `lobby/error: invalid` every other malformed command already earns. It is also the only answer
// #129 can present, since there is no channel that would tell a lobby "you got something else".
//
// Driven by the shape of `DEFAULT_WORLD_SETTINGS` rather than by a written-out list of fields, so a
// knob added to `WorldSettings` later is validated the day it appears instead of the day someone
// remembers to. The result is rebuilt key by key off that same shape — the protocol's own idiom —
// so an unknown field cannot ride along onto the wire.
export function parseWorldSettings(value: unknown): WorldSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, shipped] of Object.entries(DEFAULT_WORLD_SETTINGS)) {
    if (typeof shipped === "number") {
      if (!admissible(raw[key], key, shipped)) return null;
      out[key] = raw[key];
      continue;
    }
    // A grouped knob — the arena, or one of the three curves. Same rules, one level down.
    const group = raw[key];
    if (typeof group !== "object" || group === null) return null;
    const inner = group as Record<string, unknown>;
    const built: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(shipped as Record<string, number>)) {
      if (!admissible(inner[field], `${key}.${field}`, value)) return null;
      built[field] = inner[field];
    }
    out[key] = built;
  }
  return out as unknown as WorldSettings;
}

function admissible(value: unknown, path: string, shipped: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (POSITIVE.has(path) ? value <= 0 : value < 0) return false;
  return !COUNTS.has(path) || value <= shipped * MAX_MULTIPLE;
}

// One knob, as a control can be drawn for it (#129): the dotted path that names it, the value the game
// ships with, and the range it may offer.
//
// `min` and `max` are absent rather than infinite where no bound applies. A missing `max` means the
// knob is not one of the four that mean "make N of these" — nothing else costs the server work, so
// nothing else has a ceiling. A missing `min` means the knob is strictly positive: "greater than zero"
// has no least representable value, so there is no honest number to print in a form field. A draft
// that reaches zero is caught by `parseWorldSettings`, which is the predicate the server applies too.
export interface WorldKnob {
  path: string;
  shipped: number;
  min?: number;
  max?: number;
}

// Every knob a world has, flattened, in the order `DEFAULT_WORLD_SETTINGS` declares them.
//
// Derived from the same shape and the same three rules `parseWorldSettings` enforces rather than
// listed again where the controls are drawn: a hand-copied range is a second source of truth that can
// disagree with the validator, and ADR 0006 turns a disagreement into a lobby that appears to ignore
// the host. A knob added to `WorldSettings` also gets a control the day it appears.
export function worldKnobs(): WorldKnob[] {
  const knobs: WorldKnob[] = [];
  for (const [key, shipped] of Object.entries(DEFAULT_WORLD_SETTINGS)) {
    if (typeof shipped === "number") {
      knobs.push(bound(key, shipped));
      continue;
    }
    for (const [field, value] of Object.entries(shipped as Record<string, number>)) {
      knobs.push(bound(`${key}.${field}`, value));
    }
  }
  return knobs;
}

function bound(path: string, shipped: number): WorldKnob {
  return {
    path,
    shipped,
    ...(POSITIVE.has(path) ? {} : { min: 0 }),
    ...(COUNTS.has(path) ? { max: shipped * MAX_MULTIPLE } : {}),
  };
}

export function knobValue(settings: WorldSettings, path: string): number {
  const [key, field] = path.split(".");
  const at = (settings as unknown as Record<string, unknown>)[key];
  return field === undefined ? (at as number) : ((at as Record<string, number>)[field] as number);
}

// A candidate settings object with one knob replaced. Deliberately **not** typed `WorldSettings`: the
// value came from a form field, so this is a candidate until `parseWorldSettings` admits it — which is
// what stops a control from emitting a payload the server would refuse.
export function withKnob(settings: WorldSettings, path: string, value: number): unknown {
  const [key, field] = path.split(".");
  const out = { ...settings } as unknown as Record<string, unknown>;
  out[key] =
    field === undefined ? value : { ...(out[key] as Record<string, number>), [field]: value };
  return out;
}
