import type { LobbyCode } from "./protocol";

// Crockford base32 (drops I, L, O, U): no ambiguous glyphs, easy to read aloud and
// type. 32^4 ≈ 1.05M codes — ample for a small co-op game.
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CODE_LENGTH = 4;

// Case-insensitive input, with look-alikes folded onto their Crockford digits.
export function normalizeCode(raw: string): LobbyCode {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    const mapped = ch === "O" ? "0" : ch === "I" || ch === "L" ? "1" : ch;
    if (CROCKFORD_ALPHABET.includes(mapped)) out += mapped;
  }
  return out;
}

// `byte & 31` is unbiased because 256 % 32 == 0. Rejection-samples until the caller
// reports the code free.
export function generateCode(isInUse: (code: LobbyCode) => boolean): LobbyCode {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let code = "";
    for (const byte of bytes) code += CROCKFORD_ALPHABET[byte & 31];
    if (!isInUse(code)) return code;
  }
}
