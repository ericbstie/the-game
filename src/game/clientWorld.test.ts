import { describe, expect, test } from "bun:test";
import type { MapDelta, WorldInit } from "../lobby/protocol";
import { ClientWorld, ENEMY_RENDER_DELAY_MS, RENDER_DELAY_MS } from "./clientWorld";
import { enemyContactDamage, GRUNT_HP, GRUNT_RADIUS, NEST_COUNT } from "./enemies";
import { ARENA, PLAYER_MAX_HP, PLAYER_RADIUS } from "./world";

const STILL = { up: false, down: false, left: false, right: false };
const held = (dir: keyof typeof STILL) => ({ ...STILL, [dir]: true });

const init = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [
    { id: "self", slot: 1, name: "Me", pos: { x: 400, y: 300 } },
    { id: "peer", slot: 2, name: "You", pos: { x: 500, y: 300 } },
  ],
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
    w.stepSelf(100, held("right"));
    const snap = w.snapshot(0);
    expect(snap.players.find((p) => p.id === "self")?.pos.x).toBeGreaterThan(400);
    expect(snap.players.find((p) => p.id === "peer")?.pos).toEqual({ x: 500, y: 300 });
  });

  test("the self avatar is unaffected by the render delay", () => {
    const w = new ClientWorld(init(), "self");
    w.stepSelf(100, held("right"));
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
});
