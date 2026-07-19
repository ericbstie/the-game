import { describe, expect, test } from "bun:test";
import { CROCKFORD_ALPHABET, generateCode, normalizeCode } from "./code";

describe("normalizeCode", () => {
  test("uppercases and maps ambiguous glyphs (O->0, I/L->1)", () => {
    expect(normalizeCode("oil")).toBe("011");
    expect(normalizeCode("aB3k")).toBe("AB3K");
  });

  test("strips whitespace and non-alphabet characters", () => {
    expect(normalizeCode("  a b-3 k ")).toBe("AB3K");
  });
});

describe("generateCode", () => {
  test("is 4 characters from the Crockford alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode(() => false);
      expect(code).toHaveLength(4);
      for (const ch of code) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  test("regenerates on collision until the code is free", () => {
    const taken = new Set<string>();
    const first = generateCode(() => false);
    taken.add(first);
    const second = generateCode((c) => taken.has(c));
    expect(second).not.toBe(first);
  });
});
