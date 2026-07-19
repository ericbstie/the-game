import { describe, expect, test } from "bun:test";
import type { LobbySnapshot, ServerMessage } from "./protocol";
import { applyRoster } from "./roster";

const snapshot = (rev: number, players: LobbySnapshot["players"]): LobbySnapshot => ({
  code: "AB3K",
  phase: "lobby",
  maxPlayers: 6,
  host: "p1",
  players,
  rev,
});

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

  test("non-snapshot messages leave the baseline untouched (for now)", () => {
    const base = snapshot(0, [p("p1", 1)]);
    const superseded: ServerMessage = { type: "lobby/superseded" };
    expect(applyRoster(base, superseded)).toBe(base);
  });
});
