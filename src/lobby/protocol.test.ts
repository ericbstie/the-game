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
