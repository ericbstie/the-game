import { describe, expect, test } from "bun:test";
import { damageFx, FLASH_ALPHA, FLASH_MS, SHAKE_MS, SHAKE_REACH } from "./damageFx";

// #142: what the screen does when you are hit. Every claim here is about a pure function of one
// number — how long ago the blow landed — so the whole effect is checked without a canvas, a frame
// or a clock, exactly as `fx.ts` is.

// One frame's worth of steps across the longer of the two lives, plus a margin past the end, so a
// sweep sees both the swing and the veil out and then some.
const sweep = (to: number, step = 1) => {
  const at: number[] = [];
  for (let t = 0; t <= to; t += step) at.push(t);
  return at;
};

describe("#142: the veil the blow lays over the screen", () => {
  test("is at its blackest on the frame of the blow", () => {
    expect(damageFx(0).flash).toBe(FLASH_ALPHA);
  });

  test("only ever fades, never brightens", () => {
    let last = Number.POSITIVE_INFINITY;
    for (const t of sweep(FLASH_MS)) {
      const flash = damageFx(t).flash;
      expect(flash).toBeLessThanOrEqual(last);
      last = flash;
    }
  });

  test("is exactly nothing once its life has run out, and stays there", () => {
    expect(damageFx(FLASH_MS).flash).toBe(0);
    for (const t of sweep(FLASH_MS * 4, 7)) {
      if (t >= FLASH_MS) expect(damageFx(t).flash).toBe(0);
    }
  });

  test("never goes blacker than its own alpha", () => {
    for (const t of sweep(FLASH_MS)) {
      expect(damageFx(t).flash).toBeLessThanOrEqual(FLASH_ALPHA);
      expect(damageFx(t).flash).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("#142: the swing the blow throws the view into", () => {
  test("throws the view off the camera on the frame of the blow", () => {
    const { shake } = damageFx(0);
    expect(Math.hypot(shake.x, shake.y)).toBeGreaterThan(0);
  });

  test("never throws it further than its reach", () => {
    for (const t of sweep(SHAKE_MS)) {
      const { shake } = damageFx(t);
      expect(Math.abs(shake.x)).toBeLessThanOrEqual(SHAKE_REACH);
      expect(Math.abs(shake.y)).toBeLessThanOrEqual(SHAKE_REACH);
    }
  });

  test("crosses the camera in both directions on both axes — it is a shake, not a shove", () => {
    const swung = sweep(SHAKE_MS).map((t) => damageFx(t).shake);
    for (const axis of ["x", "y"] as const) {
      expect(swung.some((s) => s[axis] > 0)).toBe(true);
      expect(swung.some((s) => s[axis] < 0)).toBe(true);
    }
  });

  test("dies down rather than swinging as wide at the end as at the start", () => {
    const widest = (from: number, to: number) =>
      Math.max(
        ...sweep(to - from).map((t) => {
          const { shake } = damageFx(from + t);
          return Math.hypot(shake.x, shake.y);
        }),
      );
    expect(widest(SHAKE_MS / 2, SHAKE_MS)).toBeLessThan(widest(0, SHAKE_MS / 2));
  });

  test("returns the view to exactly the camera once its life has run out, and leaves it there", () => {
    expect(damageFx(SHAKE_MS).shake).toEqual({ x: 0, y: 0 });
    for (const t of sweep(SHAKE_MS * 4, 7)) {
      if (t >= SHAKE_MS) expect(damageFx(t).shake).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("#142: a frame with no blow behind it", () => {
  // What a player who has never been hit carries: `ClientWorld.damagedAt` answers negative
  // infinity, so the frame asks about a blow an infinity ago.
  test("draws nothing at all before the first blow", () => {
    expect(damageFx(Number.POSITIVE_INFINITY)).toEqual({ shake: { x: 0, y: 0 }, flash: 0 });
  });

  // Wall-clock, stepped backwards by an NTP correction, is the one way a frame can ask about a
  // blow that has not landed yet. `stepMetalFloats` bounds its own step below for the same reason.
  test("draws nothing for a clock stepped backwards", () => {
    expect(damageFx(-1)).toEqual({ shake: { x: 0, y: 0 }, flash: 0 });
    expect(damageFx(-SHAKE_MS * 2)).toEqual({ shake: { x: 0, y: 0 }, flash: 0 });
  });
});
