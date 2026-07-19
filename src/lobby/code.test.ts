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

  test("regenerates until isInUse reports the code free", () => {
    // Report the first 3 candidates as in-use so the loop is forced to run; the 4th
    // must be accepted. (A random-difference check would pass even if isInUse were
    // ignored, given the ~1M code space.)
    let calls = 0;
    const code = generateCode(() => calls++ < 3);
    expect(calls).toBe(4); // 3 rejected + 1 accepted
    expect(code).toHaveLength(4);
  });
});
