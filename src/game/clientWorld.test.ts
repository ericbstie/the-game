import { describe, expect, test } from "bun:test";
import type { MapDelta, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILDABLES,
  type BuildableSpec,
  structureBlocking,
  TILE,
  tileOf,
  tileOrigin,
} from "./build";
import {
  ClientWorld,
  ENEMY_RENDER_DELAY_MS,
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
    expect(w.peerShots()).toEqual([{ shot, at: 4_000 }]);
  });

  test("the owner's own shot is not buffered — it is drawn locally at fire time instead", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], shots: [{ id: "self", dir: { x: 1, y: 0 } }] }, 0);
    expect(w.peerShots()).toEqual([]);
  });

  test("a shot older than the retention window is dropped, even on a tick with no shots", () => {
    const w = new ClientWorld(init(), "self");
    w.applyMapDelta({ tick: 1, moves: [], shots: [{ id: "peer", dir: { x: 1, y: 0 } }] }, 0);
    w.applyMapDelta({ tick: 2, moves: [] }, SHOT_RETENTION_MS - 1);
    expect(w.peerShots()).toHaveLength(1); // still inside the window
    w.applyMapDelta({ tick: 3, moves: [] }, SHOT_RETENTION_MS + 1);
    expect(w.peerShots()).toEqual([]);
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
