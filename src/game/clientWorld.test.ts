import { describe, expect, test } from "bun:test";
import type { WorldInit } from "../lobby/protocol";
import { ClientWorld } from "./clientWorld";
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

describe("ClientWorld construction", () => {
  test("seeds one avatar per spawn, slot-ordered, with the constant radius", () => {
    const snap = new ClientWorld(init(), "self").snapshot();
    expect(snap.players.map((p) => p.id)).toEqual(["self", "peer"]);
    expect(snap.players.every((p) => p.radius === PLAYER_RADIUS)).toBe(true);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.exit).toEqual({ x: 0, y: 100, width: 18, height: 96 });
    expect(snap.arena).toEqual(ARENA);
  });

  test("selfPos returns the self avatar's spawn position", () => {
    expect(new ClientWorld(init(), "self").selfPos()).toEqual({ x: 400, y: 300 });
  });
});

describe("ClientWorld self-sim", () => {
  test("stepSelf integrates only the self avatar; peers hold still", () => {
    const w = new ClientWorld(init(), "self");
    w.stepSelf(100, held("right"));
    const snap = w.snapshot();
    const self = snap.players.find((p) => p.id === "self");
    const peer = snap.players.find((p) => p.id === "peer");
    expect(self?.pos.x).toBeGreaterThan(400);
    expect(peer?.pos).toEqual({ x: 500, y: 300 }); // untouched by local sim
  });
});

describe("ClientWorld peer positions", () => {
  test("applyPeer moves a peer to the relayed position", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 640, y: 480 }, 1);
    expect(w.snapshot().players.find((p) => p.id === "peer")?.pos).toEqual({ x: 640, y: 480 });
  });

  test("apply-if-newer: a stale or equal seq is ignored", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("peer", { x: 640, y: 480 }, 5);
    w.applyPeer("peer", { x: 0, y: 0 }, 5); // equal seq — dropped
    w.applyPeer("peer", { x: 1, y: 1 }, 3); // older seq — dropped
    expect(w.snapshot().players.find((p) => p.id === "peer")?.pos).toEqual({ x: 640, y: 480 });
  });

  test("applyPeer on an unknown id is a no-op (no brand-new mid-match avatar in M2)", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("ghost", { x: 1, y: 1 }, 1);
    expect(w.snapshot().players.map((p) => p.id)).toEqual(["self", "peer"]);
  });

  test("applyPeer can seed the self avatar (reconnect burst) before local sim resumes", () => {
    const w = new ClientWorld(init(), "self");
    w.applyPeer("self", { x: 111, y: 222 }, 9);
    expect(w.selfPos()).toEqual({ x: 111, y: 222 });
  });

  test("removePeer drops the avatar from the world", () => {
    const w = new ClientWorld(init(), "self");
    w.removePeer("peer");
    expect(w.snapshot().players.map((p) => p.id)).toEqual(["self"]);
  });
});
