import { describe, expect, test } from "bun:test";
import { DEFAULT_WORLD_SETTINGS, type WorldSettings, withKnob } from "../game/worldSettings";
import type { LobbySnapshot, ServerMessage } from "./protocol";
import { applyRoster } from "./roster";

const snapshot = (rev: number, players: LobbySnapshot["players"]): LobbySnapshot => ({
  code: "AB3K",
  phase: "lobby",
  maxPlayers: 6,
  host: "p1",
  players,
  rev,
  settings: DEFAULT_WORLD_SETTINGS,
  tutorial: false,
});

const CHOSEN = withKnob(DEFAULT_WORLD_SETTINGS, "nestCount", 7) as WorldSettings;

const p = (id: string, slot: number): LobbySnapshot["players"][number] => ({
  id,
  name: id,
  slot,
  presence: { status: "connected" },
});

describe("applyRoster", () => {
  test("a full-snapshot message replaces the baseline", () => {
    const created: ServerMessage = {
      type: "lobby/created",
      code: "AB3K",
      you: { id: "p1", token: "t", slot: 1 },
      snapshot: snapshot(0, [p("p1", 1)]),
    };
    expect(applyRoster(null, created)?.players).toHaveLength(1);
  });

  test("messages carrying no roster change leave the baseline untouched", () => {
    const base = snapshot(0, [p("p1", 1)]);
    const superseded: ServerMessage = { type: "lobby/superseded" };
    expect(applyRoster(base, superseded)).toBe(base);
  });

  test("player-joined adds the player and advances rev", () => {
    const base = snapshot(0, [p("p1", 1)]);
    const next = applyRoster(base, { type: "lobby/player-joined", player: p("p2", 2), rev: 1 });
    expect(next?.players.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(next?.rev).toBe(1);
  });

  test("player-joined keeps the roster sorted by slot", () => {
    const base = snapshot(1, [p("p1", 1), p("p3", 3)]);
    const next = applyRoster(base, { type: "lobby/player-joined", player: p("p2", 2), rev: 2 });
    expect(next?.players.map((x) => x.slot)).toEqual([1, 2, 3]);
  });

  test("player-left removes the player and frees the slot", () => {
    const base = snapshot(1, [p("p1", 1), p("p2", 2)]);
    const next = applyRoster(base, {
      type: "lobby/player-left",
      id: "p2",
      slot: 2,
      reason: "left",
      rev: 2,
    });
    expect(next?.players.map((x) => x.id)).toEqual(["p1"]);
    expect(next?.rev).toBe(2);
  });

  test("host-changed updates the host marker", () => {
    const base = snapshot(1, [p("p1", 1), p("p2", 2)]);
    const next = applyRoster(base, { type: "lobby/host-changed", host: "p2", rev: 2 });
    expect(next?.host).toBe("p2");
  });

  test("presence-changed updates just that player's presence", () => {
    const base = snapshot(1, [p("p1", 1), p("p2", 2)]);
    const next = applyRoster(base, {
      type: "lobby/presence-changed",
      id: "p2",
      presence: { status: "disconnected", graceExpiresAt: 123 },
      rev: 2,
    });
    expect(next?.players[1].presence).toEqual({ status: "disconnected", graceExpiresAt: 123 });
    expect(next?.players[0].presence).toEqual({ status: "connected" });
  });

  // The squad's view of the world the host has chosen (#129). The same delta shape and the same
  // apply-if-newer rule as every other roster change, so a duplicate is idempotent and a stale one
  // buffered across a reconnect cannot un-choose the host's world.
  test("settings-changed replaces the whole settings object and advances rev", () => {
    const base = snapshot(1, [p("p1", 1), p("p2", 2)]);
    const next = applyRoster(base, { type: "lobby/settings-changed", settings: CHOSEN, rev: 2 });
    expect(next?.settings).toEqual(CHOSEN);
    expect(next?.rev).toBe(2);
  });

  test("a stale settings-changed leaves the chosen world alone", () => {
    const base = { ...snapshot(3, [p("p1", 1)]), settings: CHOSEN };
    const stale: ServerMessage = {
      type: "lobby/settings-changed",
      settings: DEFAULT_WORLD_SETTINGS,
      rev: 3,
    };
    expect(applyRoster(base, stale)).toBe(base); // rev 3 !> 3
  });

  // The tutorial box travels the same way, on the same rule.
  test("tutorial-changed carries the host's answer and advances rev", () => {
    const base = snapshot(1, [p("p1", 1), p("p2", 2)]);
    const next = applyRoster(base, { type: "lobby/tutorial-changed", tutorial: true, rev: 2 });
    expect(next?.tutorial).toBe(true);
    expect(next?.rev).toBe(2);
  });

  test("a stale tutorial-changed leaves the host's answer alone", () => {
    const base = { ...snapshot(3, [p("p1", 1)]), tutorial: true };
    const stale: ServerMessage = { type: "lobby/tutorial-changed", tutorial: false, rev: 3 };
    expect(applyRoster(base, stale)).toBe(base);
  });

  test("a delta not newer than the baseline is ignored (apply-if-newer, idempotent)", () => {
    const base = snapshot(2, [p("p1", 1), p("p2", 2)]);
    const stale: ServerMessage = {
      type: "lobby/player-left",
      id: "p2",
      slot: 2,
      reason: "left",
      rev: 2,
    };
    expect(applyRoster(base, stale)).toBe(base); // rev 2 !> 2
    const older: ServerMessage = { type: "lobby/player-joined", player: p("p9", 3), rev: 1 };
    expect(applyRoster(base, older)).toBe(base); // rev 1 < 2
  });

  test("a delta before any snapshot is dropped", () => {
    expect(
      applyRoster(null, { type: "lobby/player-joined", player: p("p1", 1), rev: 1 }),
    ).toBeNull();
  });
});
