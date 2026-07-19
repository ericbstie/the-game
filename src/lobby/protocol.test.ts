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
});
