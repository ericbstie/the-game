# ADR 0006 — A settings payload the server will not build a world from is refused, not clamped

- **Status:** Accepted
- **Date:** 2026-07-30
- **Applies to:** `parseWorldSettings`, `game/settings`, and the lobby controls built on them
- **Decides:** the open question left in
  [#127](https://github.com/ericbstie/the-game/issues/127) and owned by
  [#128](https://github.com/ericbstie/the-game/issues/128) — what a hostile or absent settings
  payload means

## Context

#127 built the config object and deliberately built no validation: nobody had asked, and the answer
belongs where untrusted input arrives. #128 is where it arrives. Two boundaries look like candidates
and only one of them is real:

- **The server accepting settings from a host.** A client sends a JSON object and the server builds
  a world from it. This is untrusted input in the ordinary sense, and the same input every client in
  the squad then expands the same two seeds against.
- **The client accepting settings from the server.** Not a trust boundary this game has. The client
  already takes the arena, the door, both seeds and every enemy's HP from the server on faith; a
  validator here would be a second authority with nothing to enforce, and a compromised server has
  already won.

So the question is what the *server* does with a payload it cannot build a world from.

## Decision

**Refuse the message whole. Never clamp, never partially apply, never default a missing field.**
`parseWorldSettings` returns `WorldSettings | null`, `parseClientMessage` turns a `null` into a
refused message, and the hub answers the `lobby/error: invalid` every malformed command already
earns. The session keeps exactly the settings it had.

**Absence is unrepresentable rather than handled.** `WorldInit.settings` is required, so there is no
"what does an absent payload mean" on the receiving side at all — a world-init without settings does
not typecheck. On the sending side, absence is simply a host who never sent the command: a session
is minted at `DEFAULT_WORLD_SETTINGS`.

### What a payload has to satisfy

The rules are driven by a walk over `DEFAULT_WORLD_SETTINGS`, not by a written-out list of field
names, so a knob added to `WorldSettings` later is validated the day it appears rather than the day
someone remembers to. The result is rebuilt key by key off that same shape — `parseClientMessage`'s
own idiom — so an undeclared field cannot ride along onto the wire.

| | rule | why |
|---|---|---|
| every knob | present, and a finite number | a missing or `NaN` knob is a `NaN` world, and JSON cannot carry `NaN` as a number anyway |
| `arena.width/height`, `oreEdgeBias`, `nestEdgeBias` | strictly positive | each is divided by or inverted — `arena.width / 2` places every patch and nest, and a bias is used as `u ** (1 / bias)`. A zero is not a small world, it is a `NaN` one |
| everything else | non-negative | a negative count or duration is not one. Zero is legal: an ore-free world is a world |
| `metalPatches`, `powerPatches`, `nestCount`, `enemyCap` | ≤ 100 × the shipped value | the only four knobs that mean "make N of these", so the only four where a hostile figure is unbounded work |

**The ceiling is a safety bound, not a balance one, and it is provisional.** #96 already says a squad
may raise the enemy cap and spend its own frame budget, so this exists to keep generation and the
tick *finite* — not to keep a world sensible. Nothing else is capped, because nothing else means more
work: a huge `waveSize` is held by `enemyCap` (`enemies.ts` breaks the spawn loop at it), and a longer
period is less work rather than more.

### Why refusing beats clamping

**A clamped knob is a world the host did not choose and cannot see they did not choose.** Nothing on
the wire says "you asked for 5,000,000 nests and got 5,000", and there is no message that could say
it without inventing one. A refusal already has a channel, and it is the one every other bad command
uses.

**It keeps one rule at the boundary instead of two.** `parseClientMessage` is documented as the place
untrusted input is narrowed, and every other command there is all-or-nothing: a bad `tile` does not
become a rounded tile, it drops the message. Settings arriving half-honoured would be the one shape
whose narrowing edits rather than admits.

**A lobby control cannot present a clamp.** #129 shows the host a number. If the server silently
substituted another, the lobby would display a world nobody is playing until the next `WorldInit`
contradicted it. A refusal leaves the displayed value and the session's value the same thing.

## Consequences

**#129's controls must stay inside these bounds**, and they have plenty of room: 100× the shipped
value is far past anything a slider should offer. A control that can emit a value the server refuses
is a control that silently does nothing, so the range belongs in the UI as well as here.

**The arena has no upper bound, deliberately.** Positive and finite is all the generators need, and a
huge box costs the server nothing — the ore grid's size is bounded by the patch counts, not by the
box. One known limit is worth recording rather than enforcing here: `build.ts` packs a tile into one
number as `tx * 65_536 + ty`, which assumes under 65,536 tiles a side (983,040 u at `TILE` 15). Past
that, keys collide and the ore grid is degenerate — *identically* degenerate on both sides, since both
run the same function on the same seed, so it desyncs nobody. Enforcing it in `worldSettings.ts` would
mean either a second copy of `TILE` or an import cycle with `build.ts`; #129's control should simply
not offer it.

**Nothing validates settings on the client**, and that is the decision above rather than an omission.

## Alternatives rejected

**Clamp each knob into range.** Always yields a buildable world, so a squad never sees an error.
Rejected: see above — it builds a world nobody chose, and it makes the narrowing layer an editor.

**Validate on both sides of the wire.** Symmetrical, and it would catch a server bug. Rejected: the
client has no independent authority to enforce, and the check would be dead weight that reads as if
it protected something.

**No ceiling at all — finite and non-negative only.** The smallest guard, and it invents no numbers.
Rejected: `nestCount: 1e9` is an out-of-memory crash that takes every other lobby in the process with
it, and one host should not be able to do that.

**A schema library.** Ten fields, two levels deep, in a repo whose protocol is deliberately
hand-rolled ("no schema dep, per spec"). A dependency for what twenty lines already do.
