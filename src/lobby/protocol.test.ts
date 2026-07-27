import { describe, expect, test } from "bun:test";
import { isSupportedVersion, parseClientMessage } from "./protocol";

describe("isSupportedVersion", () => {
  test("accepts only the exact current version string", () => {
    expect(isSupportedVersion("1")).toBe(true);
    expect(isSupportedVersion("999")).toBe(false);
    expect(isSupportedVersion(null)).toBe(false);
    expect(isSupportedVersion("")).toBe(false);
  });
});

describe("parseClientMessage", () => {
  test("accepts each well-formed command", () => {
    expect(parseClientMessage(JSON.stringify({ type: "lobby/create", name: "Ana" }))).toEqual({
      type: "lobby/create",
      name: "Ana",
      maxPlayers: undefined,
    });
    expect(
      parseClientMessage(JSON.stringify({ type: "lobby/join", code: "AB3K", name: "Ben" })),
    ).toEqual({
      type: "lobby/join",
      code: "AB3K",
      name: "Ben",
      token: undefined,
    });
    expect(parseClientMessage(JSON.stringify({ type: "lobby/leave" }))).toEqual({
      type: "lobby/leave",
    });
  });

  test("rejects malformed input", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "lobby/unknown" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "lobby/create" }))).toBeNull(); // missing name
    expect(parseClientMessage(JSON.stringify({ type: "lobby/create", name: 7 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "lobby/join", code: "X" }))).toBeNull(); // missing name
    expect(
      parseClientMessage(JSON.stringify({ type: "lobby/create", name: "A", maxPlayers: 99 })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify(42))).toBeNull();
  });

  test("accepts game/start and game/pos", () => {
    expect(parseClientMessage(JSON.stringify({ type: "game/start" }))).toEqual({
      type: "game/start",
    });
    expect(
      parseClientMessage(JSON.stringify({ type: "game/pos", pos: { x: 12.5, y: -3 }, seq: 7 })),
    ).toEqual({ type: "game/pos", pos: { x: 12.5, y: -3 }, seq: 7 });
  });

  test("game/input is no longer a recognized command", () => {
    const move = { up: true, down: false, left: false, right: true };
    expect(parseClientMessage(JSON.stringify({ type: "game/input", move }))).toBeNull();
  });

  test("rejects a game/pos whose position or seq is not finite numbers", () => {
    expect(parseClientMessage(JSON.stringify({ type: "game/pos", seq: 1 }))).toBeNull(); // no pos
    expect(
      parseClientMessage(JSON.stringify({ type: "game/pos", pos: { x: 1, y: 2 } })),
    ).toBeNull(); // no seq
    expect(
      parseClientMessage(JSON.stringify({ type: "game/pos", pos: { x: 1 }, seq: 1 })),
    ).toBeNull(); // y missing
    expect(
      parseClientMessage(JSON.stringify({ type: "game/pos", pos: { x: "1", y: 2 }, seq: 1 })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "game/pos", pos: { x: 1, y: 2 }, seq: "1" })),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "game/pos", pos: { x: Number.NaN, y: 2 }, seq: 1 }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ type: "game/pos", pos: { x: 1, y: Number.POSITIVE_INFINITY }, seq: 1 }),
      ),
    ).toBeNull();
  });
});

describe("parseClientMessage: game/mine (M4)", () => {
  const mine = (tile: unknown, seq: unknown = 1) =>
    parseClientMessage(JSON.stringify({ type: "game/mine", tile, seq }));

  test("accepts an integer tile with a finite seq", () => {
    expect(mine({ tx: 4, ty: 7 })).toEqual({ type: "game/mine", tile: { tx: 4, ty: 7 }, seq: 1 });
  });

  test("rejects a fractional or non-numeric tile — it would index the ore grid into nonsense", () => {
    expect(mine({ tx: 4.5, ty: 7 })).toBeNull();
    expect(mine({ tx: "4", ty: 7 })).toBeNull();
    expect(mine({ tx: Number.NaN, ty: 7 })).toBeNull();
    expect(mine({ tx: 4 })).toBeNull();
    expect(mine(null)).toBeNull();
  });

  test("rejects a missing or non-finite seq", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "game/mine", tile: { tx: 4, ty: 7 } })),
    ).toBeNull();
    expect(mine({ tx: 4, ty: 7 }, "1")).toBeNull();
    expect(mine({ tx: 4, ty: 7 }, Number.NaN)).toBeNull();
  });
});

describe("parseClientMessage: game/attack carries no weapon (M4 retired melee)", () => {
  test("accepts a bare origin + aim shot", () => {
    const raw = { type: "game/attack", pos: { x: 1, y: 2 }, dir: { x: 1, y: 0 }, seq: 3 };
    expect(parseClientMessage(JSON.stringify(raw))).toEqual({
      type: "game/attack",
      pos: { x: 1, y: 2 },
      dir: { x: 1, y: 0 },
      seq: 3,
    });
  });

  test("a stale client still sending weapon:'melee' gets the one weapon, not a rejection", () => {
    const raw = {
      type: "game/attack",
      weapon: "melee",
      pos: { x: 1, y: 2 },
      dir: { x: 1, y: 0 },
      seq: 3,
    };
    const parsed = parseClientMessage(JSON.stringify(raw));
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("weapon");
  });
});

describe("parseClientMessage: game/forge carries nothing", () => {
  test("accepts a bare request — one recipe, one queue", () => {
    expect(parseClientMessage(JSON.stringify({ type: "game/forge" }))).toEqual({
      type: "game/forge",
    });
  });

  test("ignores anything a client attaches to it", () => {
    const parsed = parseClientMessage(JSON.stringify({ type: "game/forge", count: 99, seq: 3 }));
    expect(parsed).toEqual({ type: "game/forge" });
  });
});

// #93: the door's reveal is server-held. No inbound command carries it, so the narrowing here is
// where "a client cannot announce it alone" is actually enforced rather than merely intended.
describe("parseClientMessage: no command can reveal the door", () => {
  test("a reveal flag smuggled onto a command is dropped, not honoured", () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: "game/pos", pos: { x: 1, y: 2 }, seq: 1, exitRevealed: true }),
    );
    expect(parsed).toEqual({ type: "game/pos", pos: { x: 1, y: 2 }, seq: 1 });
  });

  test("no client message shape has a field for it at all", () => {
    const attempts = [
      { type: "game/start", exitRevealed: true },
      { type: "game/forge", exitRevealed: true },
      { type: "game/health", hp: 100, seq: 1, exitRevealed: true },
    ];
    for (const raw of attempts) {
      expect(parseClientMessage(JSON.stringify(raw))).not.toHaveProperty("exitRevealed");
    }
  });
});
