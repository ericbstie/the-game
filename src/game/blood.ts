import type { RenderedEnemy, Vec2 } from "../lobby/protocol";
import { type Camera, isVisible, type Viewport } from "./camera";
import { BLOODLING_RADIUS } from "./enemies";

// The blood a bloodling leaves on the ground (#140): a drip trail while it runs, and a stain where
// it goes off. **The first thing in this game that stays on the floor after the thing that made it
// has gone**, which is the whole reason this module exists rather than a few lines in `draw.ts`.
//
// **Client-derived, like the ore grid and the miner's `+1`, and nothing about it rides the wire.**
// Every live enemy's position is in every `map-delta` already and its kind arrived with its spawn,
// so a trail is a function of the stream this client is being sent — there is nothing to send. The
// alternative, streaming a decal per drip, would put an unbounded per-tick array on the game's
// fattest message for a mark that is purely cosmetic.
//
// **Accrued off the *rendered* enemies, once a frame, in the `stepMetalFloats` idiom** — a command
// as much as a query, and handed the camera for the same reason that one is: the cull decides
// whether a mark is ever *spawned*, and a mark dropped for being off screen is dropped for good. A
// bloodling bleeds across a 31,200² arena while the camera is over 800 × 600 of it, so culling at
// spawn is what makes "what nobody was looking at is not owed a mark" a property of the list rather
// than a filter the frame runs over a list that grew anyway.
//
// It is deliberately *not* in `ClientWorld` beside #115's and #116's marks, and the split has a
// reason: those fire on a delta event and this one fires on *motion*, which only a frame has. The
// half of a bloodling that must not depend on anybody drawing — the blast on the owner's health —
// is in that class, on the death it already handles. Nothing here can touch a player's HP.
//
// **What is bounded, and how.** Two bounds, and the second is the one that holds under a wave:
//
//   1. **The fade.** A mark older than `BLOOD_FADE_MS` is dropped off the list, not merely drawn
//      faint, so a match nobody is clearing does not accumulate.
//   2. **A hard ceiling on the list.** `BLOOD_CAP` marks, oldest discarded first. The fade alone is
//      not a bound: at `ENEMY_CAP` 500, a screen of bloodlings would owe ~13,000 marks inside one
//      fade, and no cull cheap enough to run per frame saves a list that size. The cap makes the
//      worst case flat — the frame can never be asked to draw more than `BLOOD_CAP` decals whatever
//      the enemy mix — and because nothing off screen is ever admitted, the cap is a bound on what
//      is *drawn* and not merely on what is held.

// One mark on the floor: where it fell, when, and how far it spreads. A drip and a stain are the
// same substance at two sizes, so they are one type and the render layer draws them one way.
export interface BloodMark {
  pos: Vec2;
  at: number;
  radius: number;
}

// How far a bloodling walks between drips: one body length, so the trail's grain is the creature's
// own size and a drip is never laid on top of the one before it. **Provisional** as a look.
export const DRIP_SPACING = BLOODLING_RADIUS * 2;
// A drip, and the blot at the middle of the stain a burst leaves. The drip is a quarter of the body
// across; the blot is the body itself, so what is left where one went off is the size of the thing
// that was standing there. **Provisional** as looks; that the stain is the wider of the two is not.
export const DROP_RADIUS = BLOODLING_RADIUS / 4;
export const STAIN_RADIUS = BLOODLING_RADIUS;

// A stain is a *cluster* and a drip is one disc, which is the only thing about the two marks that is
// not simply a size. Drawn as a single circle a stain reads as a red ball dropped on the paper —
// looked at in `bun run sprite:frame`, which is the channel for exactly this (ADR 0002 §5) — where a
// burst leaves a splat. Three lobes, the blot and two thrown off it, turned by a bearing taken from
// where it fell so two stains on one screen are not the same drawing twice (the `grassAt` idiom).
//
// They are laid as three ordinary marks rather than as one mark the render layer expands, so the
// cap counts what is actually drawn and the layer keeps its one-disc-per-mark rule.
const STAIN_LOBES: readonly { out: number; radius: number }[] = [
  { out: 0, radius: 1 },
  { out: 1, radius: 0.55 },
  { out: 1.15, radius: 0.4 },
];

// How long a mark stays. **Provisional** — the ticket fixes no duration — but derived rather than
// picked: at `BLOODLING_SPEED` a trail this old is 858 u long, which is the 800 u viewport
// `docs/frame-budget.md` measures. So a charging bloodling's whole trail fits on screen with its
// head and its tail both visible, and reads as an arrow pointing at what made it. Longer and the
// tail is somewhere nobody can see; shorter and there is no line to read.
//
// It also sets what a live bloodling holds: `BLOODLING_SPEED × BLOOD_FADE_MS / DRIP_SPACING` = 27
// marks each, so six of them on one screen — a squad's worth of trouble — is ~160 and fits inside
// the cap with room to spare. The cap is for the wave that does not.
export const BLOOD_FADE_MS = 3_000;

// The most marks the list may hold. `docs/frame-budget.md` rule 4 puts the ceiling for scattered
// per-item floor decoration at ~300 a screen, which is the same ceiling the grass is drawn under —
// and since nothing off screen is admitted, this list *is* roughly what a frame draws.
export const BLOOD_CAP = 300;

// What one bleeding bloodling is being tracked by: where it was last seen (which is where its stain
// goes when it is gone) and where it last dripped (which is what the spacing is measured from).
interface Bleeding {
  seen: Vec2;
  dripped: Vec2;
}

export interface Blood {
  bleeding: Map<string, Bleeding>;
  live: BloodMark[];
}

export function freshBlood(): Blood {
  return { bleeding: new Map(), live: [] };
}

// Advance the decals one frame and return the marks currently on the floor, oldest first.
//
// A bloodling that was here last frame and is not here now has gone off — which is what leaves the
// stain. That is the same "it is no longer in the list" test `stepMetalFloats` reads a destroyed
// miner from, and it costs nothing extra: this module is already keeping a record per bloodling, so
// its absence is the event. Nothing is hung off the enemy's own record, because that record is
// deleted by the death that makes the stain.
//
// Reading absence has one known edge and it is accepted: a reconnect keyframe rebuilds the enemy set
// (`ClientWorld.initEnemies`), so anything that died while this client was away reads as having died
// on the frame the keyframe lands. That is a handful of stains at the positions they were last seen
// at, bounded by the cull and the cap like every other mark, on a client that has just spent seconds
// looking at a frozen screen.
export function stepBlood(
  blood: Blood,
  enemies: readonly RenderedEnemy[],
  camera: Camera,
  viewport: Viewport,
  now: number,
): readonly BloodMark[] {
  const standing = new Set<string>();
  for (const enemy of enemies) {
    if (enemy.kind !== "bloodling") continue;
    standing.add(enemy.id);
    const trail = blood.bleeding.get(enemy.id);
    // One only just seen drips nothing: there is no ground it has covered on this screen yet, and a
    // mark here would be a drip laid by standing still.
    if (!trail) {
      blood.bleeding.set(enemy.id, { seen: { ...enemy.pos }, dripped: { ...enemy.pos } });
      continue;
    }
    trail.seen = { ...enemy.pos };
    const walked = Math.hypot(enemy.pos.x - trail.dripped.x, enemy.pos.y - trail.dripped.y);
    if (walked < DRIP_SPACING) continue;
    // One drip per step however far it jumped, and the spacing is measured from here rather than
    // advanced by it: a frame that took a second — or a tab that stopped drawing — owes a dozen
    // drips it never drew, and paying them into one point is a blot rather than a trail.
    trail.dripped = { ...enemy.pos };
    lay(blood, { pos: { ...enemy.pos }, at: now, radius: DROP_RADIUS }, camera, viewport);
  }

  for (const [id, trail] of blood.bleeding) {
    if (standing.has(id)) continue;
    blood.bleeding.delete(id);
    for (const lobe of stainMarks(trail.seen, now)) lay(blood, lobe, camera, viewport);
  }

  const faded = now - BLOOD_FADE_MS;
  while (blood.live.length > 0 && blood.live[0].at <= faded) blood.live.shift();
  return blood.live;
}

// The splat one bloodling leaves where it went off. Its lobes share an instant, so they dry together
// and the whole stain sits in one fade band — which is also one path in the frame.
//
// Exported because `scripts/demo-world.ts` stages one for `sprite:frame` to paint, and a
// hand-built stain there would be a fixture quietly lying about the mark it is meant to show.
export function stainMarks(at: Vec2, now: number): BloodMark[] {
  const spin = scatter(at);
  return STAIN_LOBES.map((lobe, i) => {
    const rad = spin + (i * 2 * Math.PI) / STAIN_LOBES.length;
    const reach = lobe.out * STAIN_RADIUS;
    return {
      pos: { x: at.x + Math.cos(rad) * reach, y: at.y + Math.sin(rad) * reach },
      at: now,
      radius: lobe.radius * STAIN_RADIUS,
    };
  });
}

// Which way a stain's lobes are thrown, in radians. Pure arithmetic on where it fell — the same mix
// `letteringAt` and `tileVariant` scatter with — so it costs no state and no entropy, and the same
// blow lands the same way on every screen.
function scatter(at: Vec2): number {
  const mixed = Math.imul(
    (Math.round(at.x) * 73_856_093) ^ (Math.round(at.y) * 19_349_663),
    0x45d9f3b,
  );
  return (((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000) * 2 * Math.PI;
}

// Put one mark on the floor, if anybody was looking, and hold the ceiling by dropping the oldest.
function lay(blood: Blood, mark: BloodMark, camera: Camera, viewport: Viewport): void {
  if (!isVisible(mark.pos, mark.radius, camera, viewport)) return;
  blood.live.push(mark);
  if (blood.live.length > BLOOD_CAP) blood.live.shift();
}
