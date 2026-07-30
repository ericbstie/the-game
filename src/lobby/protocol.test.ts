import { describe, expect, test } from "bun:test";
import { DEFAULT_WORLD_SETTINGS, type WorldSettings } from "../game/worldSettings";
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
      const parsed = parseClientMessage(JSON.stringify(raw));
      // A shape that stopped parsing altogether would satisfy the assertion below without the
      // parser dropping anything, so the message has to survive before its silence means much.
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("exitRevealed");
    }
  });
});

// #128. The one command that carries a whole object, and the only place a host's untrusted figures
// are ever vetted — the server generates the world for the squad, so this is the boundary that
// matters. Refused whole rather than repaired: a clamped knob would build a world the host never
// chose and could not see they had not chosen.
describe("parseClientMessage: game/settings (#128)", () => {
  const settings = (knobs: Partial<WorldSettings> = {}) => ({
    ...DEFAULT_WORLD_SETTINGS,
    ...knobs,
  });
  const parse = (payload: unknown) =>
    parseClientMessage(JSON.stringify({ type: "game/settings", settings: payload }));

  test("a whole settings object survives, knob for knob", () => {
    const chosen = settings({ metalPatches: 7, nestCount: 3, oreEdgeBias: 1.5 });
    expect(parse(chosen)).toEqual({ type: "game/settings", settings: chosen });
  });

  test("a missing knob is refused rather than defaulted", () => {
    const { nestCount, ...partial } = DEFAULT_WORLD_SETTINGS;
    expect(parse(partial)).toBeNull();
    const { nestPeriod, ...noCurve } = DEFAULT_WORLD_SETTINGS;
    expect(parse(noCurve)).toBeNull();
    expect(parse({ ...DEFAULT_WORLD_SETTINGS, nestPeriod: { startMs: 1, fallMs: 2 } })).toBeNull();
    expect(parse(undefined)).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(42)).toBeNull();
  });

  // `JSON.stringify` turns NaN and Infinity into `null`, so those two can only ever arrive here as
  // a non-number — which is exactly what this refuses. That they are refused *as numbers* is a
  // property of `parseWorldSettings` itself and is asserted where the function lives.
  test("a knob that is not a number is refused", () => {
    expect(parse(settings({ metalPatches: "140" as unknown as number }))).toBeNull();
    expect(parse(settings({ enemyCap: Number.NaN }))).toBeNull();
    expect(parse(settings({ enemyCap: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(parse(settings({ arena: { width: 1_000, height: Number.NaN } }))).toBeNull();
    expect(parse(settings({ oreEdgeBias: null as unknown as number }))).toBeNull();
  });

  test("a negative knob is refused, and the divisors must be positive rather than merely not negative", () => {
    expect(parse(settings({ metalPatches: -1 }))).toBeNull();
    expect(parse(settings({ nestPeriod: { startMs: -1, fallMs: 0, floorMs: 0 } }))).toBeNull();
    expect(parse(settings({ metalPatches: 0 }))).not.toBeNull(); // an ore-free world is a world
    // A zero here is not a small world but a NaN one: the arena's half-extent places every patch
    // and every nest, and a bias is used as `u ** (1 / bias)`.
    expect(parse(settings({ arena: { width: 0, height: 1_000 } }))).toBeNull();
    expect(parse(settings({ oreEdgeBias: 0 }))).toBeNull();
    expect(parse(settings({ nestEdgeBias: 0 }))).toBeNull();
  });

  // The four knobs that mean "make N of these" are the only unbounded work a host can ask for, and
  // every client pays it too. The ceiling is a safety bound, not a balance one — #96 already lets a
  // squad spend its own frame budget — so it sits far above anything #129 will offer.
  test("a count is refused past 100x the shipped world, and nothing else is capped", () => {
    for (const knob of ["metalPatches", "powerPatches", "nestCount", "enemyCap"] as const) {
      const shipped = DEFAULT_WORLD_SETTINGS[knob];
      expect(parse(settings({ [knob]: shipped * 100 }))).not.toBeNull();
      expect(parse(settings({ [knob]: shipped * 100 + 1 }))).toBeNull();
    }
    expect(parse(settings({ oreEdgeBias: 10_000 }))).not.toBeNull();
    expect(parse(settings({ arena: { width: 1e9, height: 1e9 } }))).not.toBeNull();
    expect(
      parse(settings({ nestPeriod: { startMs: 6e9, fallMs: 6e9, floorMs: 6e9 } })),
    ).not.toBeNull();
  });

  test("a field nobody declared does not ride along onto the wire", () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        type: "game/settings",
        settings: { ...DEFAULT_WORLD_SETTINGS, nestKinds: "all-hunters" },
      }),
    );
    expect(parsed).toEqual({ type: "game/settings", settings: DEFAULT_WORLD_SETTINGS });
  });
});
