import { describe, expect, test } from "bun:test";
import type { MapDelta, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILDABLES,
  type BuildableSpec,
  MINER_TRICKLE,
  structureBlocking,
  TILE,
  tileOf,
  tileOrigin,
} from "./build";
import {
  ClientWorld,
  DEATH_RETENTION_MS,
  ENEMY_RENDER_DELAY_MS,
  HIT_FLASH_MS,
  IMPACT_RETENTION_MS,
  RENDER_DELAY_MS,
  RESPAWN_DELAY_MS,
  SHOT_RETENTION_MS,
} from "./clientWorld";
import { enemyContactDamage, GRUNT_HP, GRUNT_RADIUS, NEST_COUNT } from "./enemies";
import { SEED_FACING } from "./facing";
import { ARENA, PLAYER_MAX_HP, PLAYER_RADIUS, PLAYER_SPEED } from "./world";

const STILL = { up: false, down: false, left: false, right: false };
const held = (dir: keyof typeof STILL) => ({ ...STILL, [dir]: true });

const init = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [
    { id: "self", slot: 1, name: "Me", pos: { x: 400, y: 300 } },
    { id: "peer", slot: 2, name: "You", pos: { x: 500, y: 300 } },
  ],
  oreSeed: 1,
});

// The render time a peer sample stamped at `arrival` is shown = arrival + RENDER_DELAY_MS.
const showAt = (arrival: number) => arrival + RENDER_DELAY_MS;
const peerPos = (w: ClientWorld, now: number) =>
  w.snapshot(now).players.find((p) => p.id === "peer")?.pos;

describe("ClientWorld construction", () => {
  test("seeds one avatar per spawn, slot-ordered, with the constant radius", () => {
    const snap = new ClientWorld(init(), "self").snapshot(0);
    expect(snap.players.map((p) => p.id)).toEqual(["self", "peer"]);
    expect(snap.players.every((p) => p.radius === PLAYER_RADIUS)).toBe(true);
    expect(snap.exit).toEqual({ x: 0, y: 100, width: 18, height: 96 });
    expect(snap.arena).toEqual(ARENA);
  });

  test("derives the nest layout from the arena (positions never ride the wire)", () => {
    const snap = new ClientWorld(init(), "self").snapshot(0);
    expect(snap.nests).toHaveLength(NEST_COUNT);
    expect(snap.nests.every((n) => n.alive)).toBe(true);
    expect(snap.nests.map((n) => n.sector).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("a peer with no samples yet renders at its spawn", () => {
    expect(peerPos(new ClientWorld(init(), "self"), 9999)).toEqual({ x: 500, y: 300 });
  });

  test("selfPos returns the self avatar's spawn position", () => {
    expect(new ClientWorld(init(), "self").selfPos()).toEqual({ x: 400, y: 300 });
  });
});

describe("ClientWorld self-sim (instant, never buffered)", () => {
  test("stepSelf integrates only the self avatar; peers hold still", () => {
    const w = new ClientWorld(init(), "self");
    w.stepSelf(100, held("right"), 0);
    const snap = w.snapshot(0);
    expect(snap.players.find((p) => p.id === "self")?.pos.x).toBeGreaterThan(400);
    expect(snap.players.find((p) => p.id === "peer")?.pos).toEqual({ x: 500, y: 300 });
  });

  test("the self avatar is unaffected by the render delay", () => {
    const w = new ClientWorld(init(), "self");
    w.stepSelf(100, held("right"), 0);
    const x = w.selfPos()?.x ?? 0;
    // Whatever `now` we sample, self is the live local position — no interpolation.
    expect(w.snapshot(0).players.find((p) => p.id === "self")?.pos.x).toBe(x);
    expect(w.snapshot(9999).players.find((p) => p.id === "self")?.pos.x).toBe(x);
  });
});

describe("ClientWorld peer interpolation", () => {
  test("a peer is rendered render-delay behind, holding its sample once reached", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 640, y: 480 }, 1, 1000);
    expect(peerPos(w, showAt(1000))).toEqual({ x: 640, y: 480 });
  });

  test("LERPs between two buffered samples at the delayed render time", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 0, y: 0 }, 1, 1000);
    w.applyPeer("peer", { x: 100, y: 0 }, 2, 1100);
    // Render time 1050 falls halfway between the two arrivals.
    expect(peerPos(w, showAt(1050))).toEqual({ x: 50, y: 0 });
  });

  test("holds the last sample on a gap (missed packet)", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 10, y: 10 }, 1, 1000);
    w.applyPeer("peer", { x: 20, y: 20 }, 2, 1050);
    // Long after the newest arrival, the peer freezes at its last known position.
    expect(peerPos(w, showAt(5000))).toEqual({ x: 20, y: 20 });
  });

  test("apply-if-newer: a stale or duplicate seq is ignored", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 640, y: 480 }, 5, 1000);
    w.applyPeer("peer", { x: 0, y: 0 }, 5, 1050); // equal seq — dropped
    w.applyPeer("peer", { x: 1, y: 1 }, 3, 1100); // older seq — dropped
    expect(peerPos(w, showAt(2000))).toEqual({ x: 640, y: 480 });
  });

  test("prunes samples older than the buffer window", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 0, y: 0 }, 1, 0); // ages out
    w.applyPeer("peer", { x: 90, y: 0 }, 2, 600); // >500ms later prunes the first
    // With the first sample pruned, an early render time clamps to the survivor, not a LERP.
    expect(peerPos(w, showAt(50))).toEqual({ x: 90, y: 0 });
  });

  test("applyPeer on an unknown id is a no-op (no brand-new mid-match avatar in M2)", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("ghost", { x: 1, y: 1 }, 1, 1000);
    expect(w.snapshot(9999).players.map((p) => p.id)).toEqual(["self", "peer"]);
  });

  test("applyPeer seeds the self avatar instantly (reconnect burst), never buffered", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("self", { x: 111, y: 222 }, 9, 1000);
    expect(w.selfPos()).toEqual({ x: 111, y: 222 });
    expect(w.snapshot(0).players.find((p) => p.id === "self")?.pos).toEqual({ x: 111, y: 222 });
  });

  test("removePeer drops the avatar from the world", () => {
    const w = new ClientWorld(init(), "self");
    w.removePeer("peer");
    expect(w.snapshot(9999).players.map((p) => p.id)).toEqual(["self"]);
  });
});

const enemyIn = (w: ClientWorld, now: number, id: string) =>
  w.snapshot(now).enemies.find((e) => e.id === id);

describe("ClientWorld enemy stream (applyMapDelta)", () => {
  test("a spawn creates a render record at its spawn pos, with kind + radius", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 900, y: 800 }, hp: GRUNT_HP, sector: 0 }],
      },
      1000,
    );
    const e = enemyIn(w, 1000, "e1");
    expect(e).toMatchObject({ kind: "grunt", hp: GRUNT_HP, radius: GRUNT_RADIUS });
    expect(e?.pos).toEqual({ x: 900, y: 800 });
  });

  test("a move buffers position, rendered ENEMY_RENDER_DELAY_MS behind the stream", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [["e1", 100, 100]],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 100, y: 100 }, hp: GRUNT_HP, sector: 0 }],
      },
      1000,
    );
    w.applyMapDelta({ tick: 2, moves: [["e1", 200, 100]] }, 1100);
    // Render time = now − delay; at now=1100+delay the newest sample (200,100) is shown.
    expect(enemyIn(w, 1100 + ENEMY_RENDER_DELAY_MS, "e1")?.pos).toEqual({ x: 200, y: 100 });
    // Halfway between the two arrivals (1050 render time) LERPs to the midpoint.
    expect(enemyIn(w, 1050 + ENEMY_RENDER_DELAY_MS, "e1")?.pos).toEqual({ x: 150, y: 100 });
  });

  test("apply-if-newer: a stale or duplicate tick is ignored", () => {
    const w = new ClientWorld(init(), "self");
    const spawn: MapDelta = {
      tick: 5,
      moves: [["e1", 10, 10]],
      spawns: [{ id: "e1", kind: "grunt", pos: { x: 10, y: 10 }, hp: GRUNT_HP, sector: 0 }],
    };
    w.applyMapDelta(spawn, 1000);
    w.applyMapDelta({ tick: 5, moves: [["e1", 999, 999]] }, 1050); // equal tick — dropped
    w.applyMapDelta({ tick: 3, moves: [["e1", 888, 888]] }, 1100); // older tick — dropped
    expect(enemyIn(w, 5000, "e1")?.pos).toEqual({ x: 10, y: 10 });
  });

  test("a hit updates the enemy's stored hp", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [["e1", 10, 10]],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 10, y: 10 }, hp: GRUNT_HP, sector: 0 }],
      },
      1000,
    );
    w.applyMapDelta({ tick: 2, moves: [["e1", 10, 10]], hits: [{ id: "e1", hp: 12 }] }, 1050);
    expect(enemyIn(w, 5000, "e1")?.hp).toBe(12);
  });

  test("a death removes the enemy from the world", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [["e1", 10, 10]],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 10, y: 10 }, hp: GRUNT_HP, sector: 0 }],
      },
      1000,
    );
    w.applyMapDelta({ tick: 2, moves: [], deaths: ["e1"] }, 1050);
    expect(w.snapshot(9999).enemies).toEqual([]);
  });

  test("a move for an unknown id is ignored (spawn must arrive first)", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [["ghost", 10, 10]] }, 1000);
    expect(w.snapshot(9999).enemies).toEqual([]);
  });

  test("initEnemies rebuilds live enemy + nest state and guards the first live delta", () => {
    const w = new ClientWorld(init(), "self");
    const nestId = w.snapshot(0).nests[0].id;
    w.initEnemies({
      tick: 100,
      enemies: [{ id: "e1", kind: "grunt", pos: { x: 5, y: 5 }, hp: 12, sector: 0 }],
      nests: [{ id: nestId, pos: { x: 0, y: 0 }, hp: 0, alive: false, sector: 0 }],
    });
    expect(enemyIn(w, 9999, "e1")).toMatchObject({ kind: "grunt", hp: 12 });
    expect(w.snapshot(0).nests.find((n) => n.id === nestId)).toMatchObject({ hp: 0, alive: false });
    // A delta at the keyframe tick is stale (dropped); the next tick applies.
    w.applyMapDelta({ tick: 100, moves: [["e1", 999, 999]] }, 0);
    w.applyMapDelta({ tick: 101, moves: [["e1", 50, 50]] }, 1000);
    expect(enemyIn(w, 1000 + ENEMY_RENDER_DELAY_MS, "e1")?.pos).toEqual({ x: 50, y: 50 });
  });

  test("a nest delta updates the matching nest's hp and alive flag", () => {
    const w = new ClientWorld(init(), "self");
    const id = w.snapshot(0).nests[0].id;
    w.applyMapDelta({ tick: 1, moves: [], nests: [{ id, hp: 0, alive: false }] }, 1000);
    const nest = w.snapshot(9999).nests.find((n) => n.id === id);
    expect(nest).toMatchObject({ hp: 0, alive: false });
  });
});

// self spawns at (400,300); a grunt placed on top of it is in contact.
const spawnOnSelf = (w: ClientWorld, at: { x: number; y: number }) =>
  w.applyMapDelta(
    { tick: 1, moves: [], spawns: [{ id: "e1", kind: "grunt", pos: at, hp: GRUNT_HP, sector: 0 }] },
    0,
  );
const GRUNT_CONTACT = enemyContactDamage("grunt");

describe("ClientWorld self-health (client-authoritative contact damage)", () => {
  test("an enemy in contact deals its contact damage on cadence, not every frame", () => {
    const w = new ClientWorld(init(), "self");
    spawnOnSelf(w, { x: 405, y: 300 }); // dist 5 < PLAYER_RADIUS + GRUNT_RADIUS
    w.updateHealth(1000); // first contact → one hit
    expect(w.hp()).toBe(PLAYER_MAX_HP - GRUNT_CONTACT);
    w.updateHealth(1100); // 100 ms later — within the 500 ms cadence, no hit
    expect(w.hp()).toBe(PLAYER_MAX_HP - GRUNT_CONTACT);
    w.updateHealth(1600); // 600 ms after the first — cadence elapsed, another hit
    expect(w.hp()).toBe(PLAYER_MAX_HP - 2 * GRUNT_CONTACT);
  });

  test("an enemy out of contact deals no damage", () => {
    const w = new ClientWorld(init(), "self");
    spawnOnSelf(w, { x: 900, y: 900 }); // far from self
    w.updateHealth(1000);
    expect(w.hp()).toBe(PLAYER_MAX_HP);
  });

  test("HP floors at 0, the player is dead, and takes no further damage", () => {
    const w = new ClientWorld(init(), "self");
    spawnOnSelf(w, { x: 400, y: 300 });
    for (let t = 1000; t <= 1000 + 25 * 500; t += 500) w.updateHealth(t); // hammer past 100 HP
    expect(w.hp()).toBe(0);
    expect(w.isDead()).toBe(true);
    w.updateHealth(1_000_000);
    expect(w.hp()).toBe(0); // dead: no further change
  });

  test("reviveSelf snaps the owner back to center at full HP", () => {
    const w = new ClientWorld(init(), "self");
    spawnOnSelf(w, { x: 400, y: 300 });
    for (let t = 1000; t <= 1000 + 25 * 500; t += 500) w.updateHealth(t);
    expect(w.isDead()).toBe(true);
    w.reviveSelf();
    expect(w.hp()).toBe(PLAYER_MAX_HP);
    expect(w.isDead()).toBe(false);
    expect(w.selfPos()).toEqual({ x: ARENA.width / 2, y: ARENA.height / 2 });
  });

  test("applyPeerHealth updates a peer's rendered HP, apply-if-newer", () => {
    const w = new ClientWorld(init(), "self");
    const peerHp = () => w.snapshot(0).players.find((p) => p.id === "peer")?.hp;
    w.applyPeerHealth("peer", 40, 1);
    expect(peerHp()).toBe(40);
    w.applyPeerHealth("peer", 999, 1); // equal seq — dropped
    expect(peerHp()).toBe(40);
    w.applyPeerHealth("peer", 10, 2); // newer
    expect(peerHp()).toBe(10);
  });

  test("applyPeerHealth on self reseeds the owner's authoritative HP (reconnect burst)", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeerHealth("self", 55, 1);
    expect(w.hp()).toBe(55);
  });

  test("a reconnect rebuild carries the owner's HP instead of resetting to full", () => {
    // Carrying the prior HP closes the window where the report loop could relay a false heal
    // before the peer-health burst reseeds the value.
    const rebuilt = new ClientWorld(init(), "self", 40);
    expect(rebuilt.hp()).toBe(40);
    expect(new ClientWorld(init(), "self").hp()).toBe(PLAYER_MAX_HP); // fresh match defaults to full
  });
});

describe("M4-T4: a wall clamps your own avatar", () => {
  const WALL = BUILDABLES.wall as BuildableSpec;
  const held = (dir: "up" | "down" | "left" | "right") => ({ ...STILL, [dir]: true });

  // Put a wall directly east of the owner's spawn and mirror it into the client's build state,
  // exactly as a `builds` delta would.
  function walledWorld() {
    const world = new ClientWorld(init(), "self");
    const spawnPos = { x: 400, y: 300 };
    const tile = tileOf({ x: spawnPos.x + PLAYER_RADIUS + 10, y: spawnPos.y - TILE });
    world.applyMapDelta(
      { tick: 1, moves: [], builds: [{ id: "w1", kind: "wall", tile, hp: WALL.hp }] },
      0,
    );
    return { world, wall: { id: "w1", kind: "wall" as const, tile, hp: WALL.hp } };
  }

  test("running into a wall stops you outside it", () => {
    const { world, wall } = walledWorld();
    for (let i = 0; i < 60; i++) world.stepSelf(100, held("right"), 0);
    const self = world.snapshot(0).players.find((p) => p.id === "self");
    expect(self?.pos.x).toBeLessThan(tileOrigin(wall.tile).x);
    expect(structureBlocking(world.build, self?.pos as Vec2, PLAYER_RADIUS)).toBeNull();
  });

  test("you slide along the wall instead of sticking to it", () => {
    const { world } = walledWorld();
    for (let i = 0; i < 60; i++) world.stepSelf(100, held("right"), 0); // press into it
    const stuck = world.snapshot(0).players.find((p) => p.id === "self")?.pos as Vec2;
    world.stepSelf(100, { ...STILL, right: true, down: true }, 0); // still pressing, now also down
    const slid = world.snapshot(0).players.find((p) => p.id === "self")?.pos as Vec2;
    expect(slid.y).toBeGreaterThan(stuck.y);
  });

  test("a demolished wall stops clamping immediately", () => {
    const { world, wall } = walledWorld();
    for (let i = 0; i < 60; i++) world.stepSelf(100, held("right"), 0);
    world.applyMapDelta({ tick: 2, moves: [], removals: [wall.id] }, 0);
    for (let i = 0; i < 10; i++) world.stepSelf(100, held("right"), 0);
    const self = world.snapshot(0).players.find((p) => p.id === "self");
    expect(self?.pos.x).toBeGreaterThan(tileOrigin(wall.tile).x);
  });
});

describe("M4-T6: you cannot walk through an enemy", () => {
  // Spawn a grunt at `pos` and stream it one move, so it has a rendered position to collide with.
  function withGrunt(pos: Vec2) {
    const world = new ClientWorld(init(), "self");
    world.applyMapDelta(
      {
        tick: 1,
        moves: [["e1", pos.x, pos.y]],
        spawns: [{ id: "e1", kind: "grunt", pos, hp: GRUNT_HP, sector: 0 }],
      },
      0,
    );
    return world;
  }
  const selfOf = (w: ClientWorld) => w.selfPos() as Vec2;

  test("walking into a grunt pushes you back out instead of through it", () => {
    const grunt = { x: 460, y: 300 }; // due east of the owner's spawn at (400, 300)
    const world = withGrunt(grunt);
    for (let i = 0; i < 30; i++) world.stepSelf(100, held("right"), 0);
    const self = selfOf(world);
    expect(Math.hypot(self.x - grunt.x, self.y - grunt.y)).toBeGreaterThanOrEqual(
      PLAYER_RADIUS + GRUNT_RADIUS - 1e-6,
    );
    expect(self.x).toBeLessThan(grunt.x); // never made it past
  });

  test("peers are not solid — squadmates pass through each other", () => {
    const world = new ClientWorld(init(), "self");
    world.applyPeer("peer", { x: 460, y: 300 }, 1, 0); // a peer right in the way
    for (let i = 0; i < 30; i++) world.stepSelf(100, held("right"), 0);
    expect(selfOf(world).x).toBeGreaterThan(460); // walked straight through
  });

  test("with no enemies at all, motion is exactly the plain integration", () => {
    const plain = new ClientWorld(init(), "self");
    const withEnemy = withGrunt({ x: 20_000, y: 20_000 }); // far away
    for (let i = 0; i < 10; i++) {
      plain.stepSelf(100, held("right"), 0);
      withEnemy.stepSelf(100, held("right"), 0);
    }
    expect(selfOf(withEnemy)).toEqual(selfOf(plain));
  });
});

describe("M4-T10: dying costs 20 seconds", () => {
  test("the respawn delay is 20 s — long enough that death is a real time penalty", () => {
    expect(RESPAWN_DELAY_MS).toBe(20_000);
  });

  test("the downed countdown reads in whole seconds from 20", () => {
    // The HUD shows `ceil(remaining / 1000)`, so the first tick after death reads "20".
    expect(Math.ceil(RESPAWN_DELAY_MS / 1000)).toBe(20);
  });

  test("the walk back from centre is the real cost — the timer alone is a fraction of it", () => {
    // Centre to the danger band is ~60 s at PLAYER_SPEED. The countdown is the down payment;
    // the walk is the rest, which is what makes dying expensive without wiping the squad.
    const walkBackMs = ((ARENA.width / 2) * 1000) / PLAYER_SPEED;
    expect(RESPAWN_DELAY_MS).toBeLessThan(walkBackMs);
    expect(RESPAWN_DELAY_MS).toBeGreaterThan(walkBackMs / 5);
  });
});

describe("M5-I4: facing and the walk cycle ride the snapshot, never the wire", () => {
  const FRAME_MS = 16;

  // Drive `frames` render frames of the owner holding `dir`, sampling the snapshot each frame
  // exactly as the render loop does — the facing EMA only advances inside `snapshot`.
  function run(w: ClientWorld, dir: keyof typeof STILL, frames: number, t0 = 0): number {
    let now = t0;
    for (let i = 0; i < frames; i++) {
      now = t0 + (i + 1) * FRAME_MS;
      w.stepSelf(FRAME_MS, held(dir), now);
      w.snapshot(now);
    }
    return now;
  }

  const selfFacing = (w: ClientWorld, now: number) =>
    w.snapshot(now).players.find((p) => p.id === "self")?.facing;

  test("the owner's facing is derived from its position, not from its MoveInput", () => {
    const w = new ClientWorld(init(), "self");
    const now = run(w, "left", 60);
    expect(selfFacing(w, now + FRAME_MS)).toBe(4); // West
  });

  test("an owner pressed into a wall holds its last facing instead of turning to the input", () => {
    // Input-derivation would read East here 100% of the time while every other screen showed
    // the last real travel direction. One rule for self and peers keeps the two agreeing.
    const w = new ClientWorld(init(), "self");
    const walked = run(w, "up", 60);
    const stopped = w.selfPos() as Vec2;
    const tile = tileOf({ x: stopped.x + PLAYER_RADIUS + 10, y: stopped.y - TILE });
    w.applyMapDelta(
      { tick: 1, moves: [], builds: [{ id: "w1", kind: "wall", tile, hp: 200 }] },
      walked,
    );
    const blocked = run(w, "right", 240, walked);
    expect(selfFacing(w, blocked + FRAME_MS)).toBe(6); // North
  });

  test("a peer's facing comes from its buffered stream", () => {
    const w = new ClientWorld(init(), "self");
    for (let i = 1; i <= 20; i++) {
      w.applyPeer("peer", { x: 500, y: 300 + i * 10 }, i, i * 50);
      w.snapshot(showAt(i * 50));
    }
    expect(w.snapshot(showAt(1000)).players.find((p) => p.id === "peer")?.facing).toBe(2); // South
  });

  test("an enemy that stops holds its last facing instead of snapping East", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 900, y: 800 }, hp: GRUNT_HP, sector: 0 }],
      },
      0,
    );
    let tick = 2;
    const show = (streamedAt: number) => streamedAt + ENEMY_RENDER_DELAY_MS;
    for (let i = 1; i <= 20; i++) {
      w.applyMapDelta({ tick: tick++, moves: [["e1", 900 - i * 9, 800]] }, i * 50);
      w.snapshot(show(i * 50));
    }
    expect(enemyIn(w, show(1000), "e1")?.facing).toBe(4); // West
    // Now HOLD: the server keeps streaming the same position, so the delta is exactly zero
    // and `Math.atan2(0, 0)` would read East.
    for (let i = 21; i <= 120; i++) {
      w.applyMapDelta({ tick: tick++, moves: [["e1", 720, 800]] }, i * 50);
      w.snapshot(show(i * 50));
    }
    expect(enemyIn(w, show(6000), "e1")?.facing).toBe(4);
  });

  test("an enemy that has never moved renders the seed facing on the stance frame", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 900, y: 800 }, hp: GRUNT_HP, sector: 0 }],
      },
      0,
    );
    for (let i = 1; i <= 60; i++) w.snapshot(i * 50);
    expect(enemyIn(w, 3050, "e1")).toMatchObject({ facing: SEED_FACING, frame: 0 });
  });
});

describe("M5-I5: the client adopts streamed aims and shots, and refuses to draw what died", () => {
  const TURRET = BUILDABLES.turret as BuildableSpec;
  const TILE_AT = { tx: 100, ty: 100 };
  const spawned = (id: string, pos: Vec2): MapDelta => ({
    tick: 1,
    moves: [],
    spawns: [{ id, kind: "grunt", pos, hp: GRUNT_HP, sector: 0 }],
  });
  // The aim as the render layer reads it, off the snapshot rather than out of the world's guts.
  const aimOf = (w: ClientWorld, id: string) => {
    const turret = w.snapshot(0).structures.find((s) => s.id === id)?.turret;
    return turret && { targetId: turret.targetId, powered: turret.powered };
  };
  const placed = (id: string) => ({ id, kind: "turret" as const, tile: TILE_AT, hp: TURRET.hp });

  test("a streamed aim lands on the mirrored turret, target and power together", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [placed("b1")] }, 0);
    w.applyMapDelta({ tick: 2, moves: [], aims: [["b1", "e9", 1]] }, 0);
    expect(aimOf(w, "b1")).toEqual({ powered: true, targetId: "e9" });
  });

  test("a turret placed and engaged in one delta still gets its aim", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [placed("b1")], aims: [["b1", "e9", 0]] }, 0);
    expect(aimOf(w, "b1")).toEqual({ powered: false, targetId: "e9" });
  });

  test("a release takes the aim back off, so the line stops being drawable", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [placed("b1")], aims: [["b1", "e9", 1]] }, 0);
    w.applyMapDelta({ tick: 2, moves: [], aims: [["b1", null, 0]] }, 0);
    expect(aimOf(w, "b1")).toEqual({ powered: false, targetId: null });
  });

  test("an aim for a structure this client never saw is ignored rather than thrown", () => {
    const w = new ClientWorld(init(), "self");
    expect(() =>
      w.applyMapDelta({ tick: 1, moves: [], aims: [["ghost", "e1", 1]] }, 0),
    ).not.toThrow();
  });

  test("the reconnect keyframe restores the aims a joiner missed", () => {
    const w = new ClientWorld(init(), "self");
    w.initBuild({
      bank: { metal: 0 },
      ammo: 0,
      queued: 0,
      power: { generation: 0, consumption: 0 },
      structures: [placed("b1")],
      aims: [["b1", "n3", 0]],
    });
    expect(aimOf(w, "b1")).toEqual({ powered: false, targetId: "n3" });
  });

  test("peer shots buffer with the instant they landed", () => {
    const w = new ClientWorld(init(), "self");
    const shot = { id: "peer", dir: { x: 1, y: 0 }, hit: "e1" };
    w.applyMapDelta({ tick: 1, moves: [], shots: [shot] }, 4_000);
    expect(w.peerShots(4_000, SHOT_RETENTION_MS)).toEqual([{ shot, at: 4_000 }]);
  });

  test("the owner's own shot is not buffered — it is drawn locally at fire time instead", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], shots: [{ id: "self", dir: { x: 1, y: 0 } }] }, 0);
    expect(w.peerShots(0, SHOT_RETENTION_MS)).toEqual([]);
  });

  test("a caller's own lifetime bounds what it gets back, not the retention window", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], shots: [{ id: "peer", dir: { x: 1, y: 0 } }] }, 0);
    const lineMs = 100; // whatever the render layer picks, well inside SHOT_RETENTION_MS
    expect(w.peerShots(lineMs - 1, lineMs)).toHaveLength(1);
    expect(w.peerShots(lineMs + 1, lineMs)).toEqual([]); // still retained, but too old to draw
    expect(w.peerShots(lineMs + 1, SHOT_RETENTION_MS)).toHaveLength(1);
  });

  test("a shot older than the retention window is dropped, even on a tick with no shots", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], shots: [{ id: "peer", dir: { x: 1, y: 0 } }] }, 0);
    w.applyMapDelta({ tick: 2, moves: [] }, SHOT_RETENTION_MS - 1);
    expect(w.peerShots(0, SHOT_RETENTION_MS)).toHaveLength(1); // still inside the window
    w.applyMapDelta({ tick: 3, moves: [] }, SHOT_RETENTION_MS + 1);
    expect(w.peerShots(0, SHOT_RETENTION_MS)).toEqual([]);
  });

  test("a live enemy's target id resolves to where it is rendered", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(spawned("e1", { x: 900, y: 800 }), 0);
    expect(w.shotTargetPos("e1", 0)).toEqual({ x: 900, y: 800 });
  });

  test("an enemy killed in the same delta that named it resolves to nothing", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(spawned("e1", { x: 900, y: 800 }), 0);
    // The one-tick death window: the sim reports the shot and the death it caused together.
    w.applyMapDelta(
      {
        tick: 2,
        moves: [],
        deaths: ["e1"],
        shots: [{ id: "peer", dir: { x: 1, y: 0 }, hit: "e1" }],
      },
      0,
    );
    expect(w.shotTargetPos("e1", 0)).toBeNull();
  });

  test("a turret still naming the enemy it just killed resolves to nothing", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(spawned("e1", { x: 900, y: 800 }), 0);
    w.applyMapDelta({ tick: 2, moves: [], builds: [placed("b1")], aims: [["b1", "e1", 1]] }, 0);
    w.applyMapDelta({ tick: 3, moves: [], deaths: ["e1"] }, 0);
    expect(aimOf(w, "b1")?.targetId).toBe("e1"); // the sim re-targets next tick, not this one
    expect(w.shotTargetPos("e1", 0)).toBeNull(); // so the line is refused here instead
  });

  test("a standing nest resolves, and a silenced one does not", () => {
    const w = new ClientWorld(init(), "self");
    const nest = w.snapshot(0).nests[0];
    expect(w.shotTargetPos(nest.id, 0)).toEqual(nest.pos);
    w.applyMapDelta({ tick: 1, moves: [], nests: [{ id: nest.id, hp: 0, alive: false }] }, 0);
    expect(w.shotTargetPos(nest.id, 0)).toBeNull();
  });

  test("an id this client has never heard of resolves to nothing", () => {
    expect(new ClientWorld(init(), "self").shotTargetPos("nobody", 0)).toBeNull();
  });
});

// The state behind the HUD's warning bell (#76 §5). The wire reports damage, an edge; the icon
// reports being under attack, a condition. These pin the translation between the two.
describe("ClientWorld structure-under-attack window", () => {
  const WINDOW = 2000;
  const tile = tileOf({ x: 600, y: 600 });
  const wall = { id: "w1", kind: "wall" as const, tile, hp: 400 };

  test("nothing is under attack in a match where nothing has been bitten", () => {
    const w = new ClientWorld(init(), "self");
    expect(w.structureUnderAttack(0, WINDOW)).toBe(false);
    expect(w.structureUnderAttack(1_000_000, WINDOW)).toBe(false);
  });

  test("a bite on a standing structure raises it, and it lapses after the window", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [wall] }, 1000);
    w.applyMapDelta({ tick: 2, moves: [], structHits: [{ id: "w1", hp: 380 }] }, 2000);
    expect(w.structureUnderAttack(2000, WINDOW)).toBe(true);
    expect(w.structureUnderAttack(2000 + WINDOW - 1, WINDOW)).toBe(true);
    expect(w.structureUnderAttack(2000 + WINDOW, WINDOW)).toBe(false);
  });

  test("each further bite pushes the window out, so a base being chewed holds it steady", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [wall] }, 0);
    w.applyMapDelta({ tick: 2, moves: [], structHits: [{ id: "w1", hp: 380 }] }, 1000);
    w.applyMapDelta({ tick: 3, moves: [], structHits: [{ id: "w1", hp: 360 }] }, 2500);
    expect(w.structureUnderAttack(2500 + WINDOW - 1, WINDOW)).toBe(true);
  });

  // The whole reason this reads `structHits` and not `removals`: demolishing your own wall is not
  // an attack, and flashing a warning at a player tidying up would be worse than showing nothing.
  test("demolishing your own structure is not an attack", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [wall] }, 0);
    w.applyMapDelta({ tick: 2, moves: [], removals: ["w1"] }, 1000);
    expect(w.structureUnderAttack(1000, WINDOW)).toBe(false);
  });

  test("a hit naming a structure this client has never seen raises nothing", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], structHits: [{ id: "ghost", hp: 10 }] }, 1000);
    expect(w.structureUnderAttack(1000, WINDOW)).toBe(false);
  });
});

// #107: a spider turns white for a split second when it takes damage. The events for it already
// stream — `MapDelta.hits` — so all this state is, is when the last one landed. What the tests here
// pin is *which clock it is measured on*: enemies render ENEMY_RENDER_DELAY_MS behind their stream,
// so a flash timed off the raw arrival fires half a tick before the sprite it belongs to.
describe("#107: the hit flash rides the clock the sprite is drawn on", () => {
  const shot = (w: ClientWorld, tick: number, at: number, hp: number) =>
    w.applyMapDelta({ tick, moves: [["e1", 10, 10]], hits: [{ id: "e1", hp }] }, at);
  const spawned = () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [["e1", 10, 10]],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 10, y: 10 }, hp: GRUNT_HP, sector: 0 }],
      },
      1000,
    );
    return w;
  };
  const flashing = (w: ClientWorld, now: number) => enemyIn(w, now, "e1")?.flashing;

  test("an enemy nobody has shot never flashes", () => {
    expect(flashing(spawned(), 9999)).toBe(false);
  });

  test("the flash starts when the rendered position reaches the hit, not when the event lands", () => {
    const w = spawned();
    shot(w, 2, 2000, 12);
    expect(flashing(w, 2000)).toBe(false); // the sprite on screen is still 50 ms short of the hit
    expect(flashing(w, 2000 + ENEMY_RENDER_DELAY_MS)).toBe(true);
  });

  test("and lasts exactly HIT_FLASH_MS on that same clock", () => {
    const w = spawned();
    shot(w, 2, 2000, 12);
    const last = 2000 + ENEMY_RENDER_DELAY_MS + HIT_FLASH_MS - 1;
    expect(flashing(w, last)).toBe(true);
    expect(flashing(w, last + 1)).toBe(false);
  });

  test("a second hit re-arms it, so sustained fire keeps flashing", () => {
    const w = spawned();
    shot(w, 2, 2000, 20);
    shot(w, 3, 2000 + HIT_FLASH_MS, 12);
    const after = 2000 + ENEMY_RENDER_DELAY_MS + HIT_FLASH_MS;
    expect(flashing(w, after)).toBe(true); // the first flash has lapsed; the second is up
  });

  test("a reconnect keyframe brings enemies back unflashed", () => {
    const w = spawned();
    shot(w, 2, 2000, 12);
    w.initEnemies({
      tick: 100,
      enemies: [{ id: "e1", kind: "grunt", pos: { x: 10, y: 10 }, hp: 12, sector: 0 }],
      nests: [],
    });
    expect(flashing(w, 2000 + ENEMY_RENDER_DELAY_MS)).toBe(false);
  });
});

// #115: a starburst is struck where a shot connects. The mark is what this class holds — a point and
// the instant the hit that made it arrived — and it is held back until the sprite the blow landed on
// has caught up with it, which is the trap #107 called out and the same answer.
describe("#115: the mark left where a shot connects", () => {
  // The stream, at the 20 Hz it really runs at: one move for the enemy every tick, and a hit on the
  // ticks a shot lands. The enemy walks, because a mark that rides its target and a mark struck
  // where the blow landed are the same point only while nothing moves.
  const TICK_MS = 50;
  const STEP = 8; // world units a grunt covers in one tick, near enough
  const walking = (hitOn: number[], ticks = 6, from = 1_000) => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 500, y: 300 }, hp: GRUNT_HP, sector: 0 }],
      },
      from,
    );
    for (let i = 0; i < ticks; i++) {
      const at = from + i * TICK_MS;
      w.applyMapDelta(
        {
          tick: 2 + i,
          moves: [["e1", 500 + i * STEP, 300]],
          ...(hitOn.includes(i) ? { hits: [{ id: "e1", hp: GRUNT_HP - 3 }] } : {}),
        },
        at,
      );
    }
    return w;
  };

  test("a squad that has hit nothing has no marks up", () => {
    const w = walking([]);
    // Asked at the instant the sprites reach the first tick of the stream — which is when a mark
    // laid by anything other than a hit would be showing — and again long after everything.
    expect(w.impactMarks(1_000 + ENEMY_RENDER_DELAY_MS, HIT_FLASH_MS)).toEqual([]);
    expect(w.impactMarks(9_999, HIT_FLASH_MS)).toEqual([]);
  });

  test("the mark is held back until the sprite reaches it, then lasts exactly the life asked for", () => {
    const w = walking([1]);
    const landed = 1_000 + TICK_MS; // the client instant the hit arrived
    const up = (now: number) => w.impactMarks(now, HIT_FLASH_MS).length;
    expect(up(landed)).toBe(0); // the spider on screen is still a render delay short of the blow
    expect(up(landed + ENEMY_RENDER_DELAY_MS - 1)).toBe(0);
    expect(up(landed + ENEMY_RENDER_DELAY_MS)).toBe(1);
    expect(up(landed + ENEMY_RENDER_DELAY_MS + HIT_FLASH_MS - 1)).toBe(1);
    expect(up(landed + ENEMY_RENDER_DELAY_MS + HIT_FLASH_MS)).toBe(0);
  });

  // The whole of what the ticket asks for, in one claim: the burst lands *on* the drawing. Both
  // sides are read off the same frame — where the mark says the blow was, and where `snapshot` is
  // interpolating that spider to — so nothing here can pass by agreeing with itself.
  test("the mark stands exactly where the sprite is when it is revealed", () => {
    const w = walking([1]);
    const shown = 1_000 + TICK_MS + ENEMY_RENDER_DELAY_MS;
    expect(w.impactMarks(shown, HIT_FLASH_MS)[0]?.pos).toEqual(
      enemyIn(w, shown, "e1")?.pos as Vec2,
    );
  });

  // It marks the blow, not the thing that took it. A spider walks a good part of its own width over
  // the life of the mark, and a burst dragged along behind it stops reading as an impact.
  test("the spider walks out from under its own mark", () => {
    const w = walking([1]);
    const shown = 1_000 + TICK_MS + ENEMY_RENDER_DELAY_MS;
    const later = shown + HIT_FLASH_MS - 1;
    const struck = w.impactMarks(shown, HIT_FLASH_MS)[0]?.pos;
    expect(w.impactMarks(later, HIT_FLASH_MS)[0]?.pos).toEqual(struck as Vec2);
    expect(enemyIn(w, later, "e1")?.pos.x).toBeGreaterThan((struck as Vec2).x);
  });

  test("sustained fire lays one mark per hit, each on its own clock", () => {
    const w = walking([1, 2]);
    const first = 1_000 + TICK_MS + ENEMY_RENDER_DELAY_MS;
    expect(w.impactMarks(first, HIT_FLASH_MS).length).toBe(1);
    expect(w.impactMarks(first + TICK_MS, HIT_FLASH_MS).length).toBe(2);
    const marks = w.impactMarks(first + TICK_MS, HIT_FLASH_MS);
    expect(marks[1].pos.x).toBeGreaterThan(marks[0].pos.x);
  });

  // `reapDamage` reports an enemy hit and then killed as a death alone (`enemies.ts:618`), so the
  // killing blow never reaches this class as a hit and this is not a case that has to be excluded —
  // it is one that cannot arrive. #116's puff is what marks a death, and it cannot hang off the
  // enemy record either: the death is the tick that record is deleted on.
  test("a death on its own leaves no mark here", () => {
    const w = walking([]);
    w.applyMapDelta({ tick: 99, moves: [], deaths: ["e1"] }, 1_400);
    expect(w.impactMarks(1_400 + ENEMY_RENDER_DELAY_MS, HIT_FLASH_MS)).toEqual([]);
  });

  // The same unknown-id guard `moves` and `structHits` already apply: an id this client has never
  // seen says nothing about where anything is, so there is no point to strike a burst at.
  test("a hit naming an enemy this client has never seen marks nothing", () => {
    const w = walking([]);
    w.applyMapDelta({ tick: 99, moves: [], hits: [{ id: "ghost", hp: 4 }] }, 1_400);
    expect(w.impactMarks(1_400 + ENEMY_RENDER_DELAY_MS, HIT_FLASH_MS)).toEqual([]);
  });

  // A tab that is not drawing still takes every delta, so the marks have to be pruned by the stream
  // and not by the frame — the memory bound `shots` already has, for the same reason.
  test("marks are pruned by the stream, so a match that is never drawn cannot pile them up", () => {
    const w = walking([0, 1, 2, 3, 4, 5]);
    const last = 1_000 + 5 * TICK_MS;
    const swept = last + IMPACT_RETENTION_MS + 1;
    w.applyMapDelta({ tick: 50, moves: [["e1", 900, 300]] }, swept);
    // Asked for on a window far longer than anything the render layer would ever pass, so this is
    // the buffer being empty rather than the query declining to hand its contents over.
    expect(w.impactMarks(swept, IMPACT_RETENTION_MS * 10)).toEqual([]);
  });
});

// #116: an ink puff is struck where an enemy dies. The same `Mark` #115 holds, on its own list, with
// one difference that is the whole of the ticket: a hit's sprite has yet to reach the blow, and a
// death's sprite is *deleted* — so a puff waits for nothing, or it fires into a hole where the
// spider used to be.
describe("#116: the mark left where an enemy dies", () => {
  const TICK_MS = 50;
  const STEP = 8; // world units a grunt covers in one tick, near enough
  // The stream at the 20 Hz it really runs at, with the enemy walking and dying on `diesOn`. It has
  // to walk: a mark timed against the sprite and a mark timed against the stream are the same point
  // only while nothing moves, and they are the two answers this describe block tells apart.
  const walking = (diesOn: number | null, ticks = 6, from = 1_000) => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: 500, y: 300 }, hp: GRUNT_HP, sector: 0 }],
      },
      from,
    );
    for (let i = 0; i < ticks; i++) {
      w.applyMapDelta(
        {
          tick: 2 + i,
          moves: [["e1", 500 + i * STEP, 300]],
          ...(diesOn === i ? { deaths: ["e1"] } : {}),
        },
        from + i * TICK_MS,
      );
    }
    return w;
  };

  const PUFF_LIFE = 180;
  const DIES_ON = 3;
  const killed = 1_000 + DIES_ON * TICK_MS; // the client instant the death arrived

  test("a wave nothing has killed has no puffs up", () => {
    const w = walking(null);
    expect(w.deathMarks(1_000, PUFF_LIFE)).toEqual([]);
    expect(w.deathMarks(1_000 + ENEMY_RENDER_DELAY_MS, PUFF_LIFE)).toEqual([]);
    expect(w.deathMarks(9_999, PUFF_LIFE)).toEqual([]);
  });

  // The first of the two timing boxes: the puff stands where the *sprite* last stood, which is a
  // render delay behind where the stream had got the spider to. Both sides are read off `snapshot`,
  // on the frame before the death lands, so nothing here can pass by agreeing with itself.
  test("the puff stands where the sprite stood, not where the stream had got to", () => {
    const w = walking(null, DIES_ON);
    const lastDrawn = enemyIn(w, killed, "e1")?.pos as Vec2;
    w.applyMapDelta(
      { tick: 90, moves: [["e1", 500 + DIES_ON * STEP, 300]], deaths: ["e1"] },
      killed,
    );
    const puff = w.deathMarks(killed, PUFF_LIFE)[0]?.pos as Vec2;
    expect(puff).toEqual(lastDrawn);
    // And that this is a claim at all: the stream is a whole tick of walking further on.
    expect(puff.x).toBeLessThan(500 + DIES_ON * STEP);
  });

  // The second box, and the one the render delay makes a trap. A hit's mark is held back until the
  // sprite reaches it (`impactMarks`); a death's sprite never reaches anything, because the record
  // is deleted the instant the delta lands. Held back the same way, the puff would start a render
  // delay after the spider had already gone — the gap this test exists to close.
  test("the puff is already up on the first frame the sprite is gone", () => {
    const w = walking(null, DIES_ON);
    expect(enemyIn(w, killed, "e1")).toBeDefined();
    w.applyMapDelta({ tick: 90, moves: [], deaths: ["e1"] }, killed);
    expect(enemyIn(w, killed, "e1")).toBeUndefined();
    expect(w.deathMarks(killed, PUFF_LIFE).length).toBe(1);
  });

  // The seam between the two boxes, swept rather than sampled at its ends. The removal and the puff
  // are judged on different clocks, so the frame to worry about is not either end of the life — it
  // is every frame around the handover, and there must be no instant on which the spider is off the
  // screen and nothing has taken its place.
  test("no frame passes with the spider gone and nothing in its place", () => {
    const w = walking(null, DIES_ON);
    for (let now = killed - TICK_MS; now < killed; now++) {
      expect(enemyIn(w, now, "e1")).toBeDefined();
      expect(w.deathMarks(now, PUFF_LIFE).length).toBe(0);
    }
    w.applyMapDelta({ tick: 90, moves: [], deaths: ["e1"] }, killed);
    for (let now = killed; now < killed + PUFF_LIFE; now++) {
      expect(enemyIn(w, now, "e1")).toBeUndefined();
      expect(w.deathMarks(now, PUFF_LIFE).length).toBe(1);
    }
  });

  // Measured from the instant the death arrived, with no render delay anywhere in it. Both ends
  // matter: the delay applied here would open the mark late (the box above) *and* retire it late,
  // holding ink on the paper a twentieth of a second after the effect was meant to be over.
  test("it lasts exactly the life asked for, with no render delay added to either end", () => {
    const w = walking(DIES_ON);
    const up = (now: number) => w.deathMarks(now, PUFF_LIFE).length;
    expect(up(killed)).toBe(1);
    expect(up(killed + PUFF_LIFE - 1)).toBe(1);
    expect(up(killed + PUFF_LIFE)).toBe(0);
  });

  // It marks where the spider fell, not a point that keeps moving after it. Nothing is left to
  // interpolate, so this is really a claim that the position was frozen when it was taken.
  test("the puff holds its point for the whole of its life", () => {
    const w = walking(DIES_ON);
    const struck = w.deathMarks(killed, PUFF_LIFE)[0]?.pos as Vec2;
    expect(w.deathMarks(killed + PUFF_LIFE - 1, PUFF_LIFE)[0]?.pos).toEqual(struck);
  });

  // A wave clear is many deaths on one tick, and each is its own mark.
  test("a wave cleared at once puffs once per enemy, each where that enemy fell", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [1, 2, 3].map((i) => ({
          id: `e${i}`,
          kind: "grunt" as const,
          pos: { x: 500 + i * 40, y: 300 },
          hp: GRUNT_HP,
          sector: 0,
        })),
      },
      1_000,
    );
    w.applyMapDelta({ tick: 2, moves: [], deaths: ["e1", "e2", "e3"] }, 1_050);
    const marks = w.deathMarks(1_050, PUFF_LIFE);
    expect(marks.map((m) => m.pos.x)).toEqual([540, 580, 620]);
  });

  // The same unknown-id guard `moves`, `hits` and `structHits` already apply. A death naming an id
  // this client has never seen says nothing about where anything stood, so there is no point to
  // strike a puff at — and a keyframe rebuild is exactly how a client ends up being told about one.
  test("a death naming an enemy this client has never seen puffs nothing", () => {
    const w = walking(null);
    w.applyMapDelta({ tick: 99, moves: [], deaths: ["ghost"] }, 1_400);
    expect(w.deathMarks(1_400, PUFF_LIFE)).toEqual([]);
  });

  test("a hit on its own leaves no puff here", () => {
    const w = walking(null);
    w.applyMapDelta({ tick: 99, moves: [], hits: [{ id: "e1", hp: 4 }] }, 1_400);
    expect(w.deathMarks(1_400, PUFF_LIFE)).toEqual([]);
  });

  // A tab that is not drawing still takes every delta, so the puffs have to be pruned by the stream
  // and not by the frame — the memory bound `shots` and `impacts` already have, for the same reason.
  test("puffs are pruned by the stream, so a match that is never drawn cannot pile them up", () => {
    const w = walking(2);
    const swept = 1_000 + 2 * TICK_MS + DEATH_RETENTION_MS + 1;
    w.applyMapDelta({ tick: 50, moves: [] }, swept);
    // Asked for on a window far longer than anything the render layer would ever pass, so this is
    // the buffer being empty rather than the query declining to hand its contents over.
    expect(w.deathMarks(swept, DEATH_RETENTION_MS * 10)).toEqual([]);
  });
});

// #105: the Metal-per-second reading the HUD slides up behind the Metal readout. Derived here, from
// the structure set the deltas already mirror, so the rate costs nothing on the wire.
describe("#105: the squad's Metal rate", () => {
  const miner = (id: string, tx: number) => ({
    id,
    kind: "miner" as const,
    tile: { tx, ty: 40 },
    hp: 200,
  });

  test("is zero with nothing standing", () => {
    expect(new ClientWorld(init(), "self").metalRate()).toBe(0);
  });

  test("counts every streamed miner, and only miners", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: [
          miner("m1", 40),
          miner("m2", 44),
          { id: "w1", kind: "wall", tile: { tx: 60, ty: 40 }, hp: 400 },
        ],
      },
      1000,
    );
    expect(w.metalRate()).toBe(2 * MINER_TRICKLE);
  });

  test("a miner leaves the rate the tick it is removed, with nothing left trickling", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], builds: [miner("m1", 40)] }, 1000);
    w.applyMapDelta({ tick: 2, moves: [], removals: ["m1"] }, 1050);
    expect(w.metalRate()).toBe(0);
  });

  test("a reconnect keyframe rebuilds it", () => {
    const w = new ClientWorld(init(), "self");
    w.initBuild({
      bank: { metal: 10 },
      ammo: 0,
      queued: 0,
      power: { generation: 0, consumption: 0 },
      structures: [miner("m1", 40), miner("m2", 44), miner("m3", 48)],
      aims: [],
    });
    expect(w.metalRate()).toBe(3 * MINER_TRICKLE);
  });
});

// #102: the pool is server-owned, and the client mirrors it so the trigger can be gated on a
// number the server agrees with — a shot it would refuse for want of a bullet must never be drawn.
describe("#102: the squad's bullets are mirrored from the stream", () => {
  test("a fresh world holds no bullets", () => {
    expect(new ClientWorld(init(), "self").ammo()).toBe(0);
  });

  test("a delta's count replaces the mirror", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], ammo: 3 }, 0);
    expect(w.ammo()).toBe(3);
  });

  test("an emptied pool arrives as a zero, not as a missing field", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], ammo: 1 }, 0);
    w.applyMapDelta({ tick: 2, moves: [], ammo: 0 }, 50);
    expect(w.ammo()).toBe(0);
  });

  test("a tick that carries no ammo leaves the mirror where it was", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], ammo: 2 }, 0);
    w.applyMapDelta({ tick: 2, moves: [] }, 50);
    expect(w.ammo()).toBe(2);
  });

  test("the reconnect keyframe rebuilds it", () => {
    const w = new ClientWorld(init(), "self");
    w.initBuild({
      bank: { metal: 10 },
      ammo: 7,
      queued: 0,
      power: { generation: 0, consumption: 0 },
      structures: [],
      aims: [],
    });
    expect(w.ammo()).toBe(7);
  });
});

// #102 stage 3: the HUD shows how many bullets are queued and how far the one at the head has got.
// Neither is derivable from the bullet count — an increment says a bullet finished, never whether
// another is behind it — so `queued` rides the wire. Its *phase* does not: `FORGE_MS` is a constant
// both sides compile against, so the client anchors a clock at the arrival that restarted the head
// bullet and integrates from there, rather than being told a countdown twenty times a second.
describe("#102: the forge queue is mirrored, and its clock anchors on what arrived", () => {
  const forging = (queued: number, at: number, ammo?: number) => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], queued, ammo }, at);
    return w;
  };

  test("a fresh world has nothing queued and no forge running", () => {
    const w = new ClientWorld(init(), "self");
    expect(w.queuedBullets()).toBe(0);
    expect(w.forgeStartedAt()).toBeNull();
  });

  test("a delta's queue replaces the mirror", () => {
    expect(forging(2, 0).queuedBullets()).toBe(2);
  });

  test("an order landing on an idle forge starts the clock at that arrival", () => {
    expect(forging(1, 1_000).forgeStartedAt()).toBe(1_000);
  });

  test("orders joining a forge already running leave the head bullet's clock alone", () => {
    const w = forging(1, 1_000);
    w.applyMapDelta({ tick: 2, moves: [], queued: 3 }, 1_050);
    expect(w.forgeStartedAt()).toBe(1_000);
  });

  test("a bullet arriving restarts the clock for the one behind it", () => {
    const w = forging(2, 1_000);
    w.applyMapDelta({ tick: 2, moves: [], queued: 1, ammo: 1 }, 2_000);
    expect(w.forgeStartedAt()).toBe(2_000);
  });

  // A completion and a fresh order can land on the same tick, which leaves `queued` exactly where
  // it was. The bullet count is what says a forge finished, so the restart hangs on that rather
  // than on the queue's shape — otherwise the overlay would run past the end of its bullet.
  test("a completion masked by a new order in the same tick still restarts the clock", () => {
    const w = forging(1, 1_000);
    w.applyMapDelta({ tick: 2, moves: [], queued: 1, ammo: 1 }, 2_000);
    expect(w.forgeStartedAt()).toBe(2_000);
  });

  test("a shot spending a bullet does not restart the clock", () => {
    const w = forging(1, 1_000, 5);
    w.applyMapDelta({ tick: 2, moves: [], ammo: 4 }, 1_500);
    expect(w.forgeStartedAt()).toBe(1_000);
  });

  test("the last bullet leaving the queue stops the forge", () => {
    const w = forging(1, 1_000);
    w.applyMapDelta({ tick: 2, moves: [], queued: 0, ammo: 1 }, 2_000);
    expect(w.queuedBullets()).toBe(0);
    expect(w.forgeStartedAt()).toBeNull();
  });

  test("a tick that carries no queue leaves the mirror where it was", () => {
    const w = forging(2, 1_000);
    w.applyMapDelta({ tick: 2, moves: [] }, 1_050);
    expect(w.queuedBullets()).toBe(2);
  });

  // A keyframe says how many are queued and nothing about how far the head has got, so the clock
  // stays unanchored and the overlay holds off until the next bullet lands — at most one forge
  // away. Anchoring here instead would draw a countdown from a phase the client never received.
  test("the reconnect keyframe rebuilds the queue and leaves the clock unanchored", () => {
    const w = forging(1, 1_000); // a clock already running, so the keyframe has one to clear
    w.initBuild({
      bank: { metal: 10 },
      ammo: 2,
      queued: 3,
      power: { generation: 0, consumption: 0 },
      structures: [],
      aims: [],
    });
    expect(w.queuedBullets()).toBe(3);
    expect(w.forgeStartedAt()).toBeNull();
  });
});

// #93: the door's reveal is server-held. The client mirrors what it was told and has no path of
// its own to decide the door is found — nor any to decide it is lost again.
describe("the door's reveal is mirrored, never decided here", () => {
  const revealed = (w: ClientWorld) => w.snapshot(0).exitRevealed;
  const keyframe = (tick: number, exitRevealed?: true) => ({
    tick,
    enemies: [],
    nests: [],
    exitRevealed,
  });

  test("a fresh world has the door hidden, even though world-init carried its position", () => {
    const w = new ClientWorld(init(), "self");
    expect(w.snapshot(0).exit).toEqual({ x: 0, y: 100, width: 18, height: 96 });
    expect(revealed(w)).toBe(false);
  });

  test("the flag on a delta reveals it", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], exitRevealed: true }, 0);
    expect(revealed(w)).toBe(true);
  });

  test("every later delta omits the flag, and the door stays found", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], exitRevealed: true }, 0);
    for (let tick = 2; tick <= 20; tick++) w.applyMapDelta({ tick, moves: [] }, tick * 50);
    expect(revealed(w)).toBe(true);
  });

  test("the reconnect keyframe reveals a door found before this client arrived", () => {
    const w = new ClientWorld(init(), "self");
    w.initEnemies(keyframe(40, true));
    expect(revealed(w)).toBe(true);
  });

  test("a keyframe that says nothing about the door cannot take it back", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], exitRevealed: true }, 0);
    w.initEnemies(keyframe(40));
    expect(revealed(w)).toBe(true);
  });

  test("a keyframe from a match where nobody has found it yet leaves it hidden", () => {
    const w = new ClientWorld(init(), "self");
    w.initEnemies(keyframe(40));
    expect(revealed(w)).toBe(false);
  });
});
