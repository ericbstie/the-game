import { describe, expect, test } from "bun:test";
import type { WorldInit } from "../lobby/protocol";
import { ClientWorld, RENDER_DELAY_MS } from "./clientWorld";
import { ARENA, PLAYER_RADIUS } from "./world";

const STILL = { up: false, down: false, left: false, right: false };
const held = (dir: keyof typeof STILL) => ({ ...STILL, [dir]: true });

const init = (): WorldInit => ({
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  monsters: [{ id: "m1", pos: { x: 90, y: 90 }, radius: 16 }],
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
    expect(snap.monsters).toHaveLength(1);
    expect(snap.exit).toEqual({ x: 0, y: 100, width: 18, height: 96 });
    expect(snap.arena).toEqual(ARENA);
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
