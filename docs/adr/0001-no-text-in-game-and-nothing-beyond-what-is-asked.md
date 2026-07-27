# ADR 0001 — No text in the game world, and nothing built beyond what was asked

- **Status:** Accepted
- **Date:** 2026-07-25
- **Applies to:** every milestone from Milestone 5 onward, not just the sprite work

## Context

Through four milestones the game accumulated explanatory text as a matter of habit: a hint
line spelling out the controls, a label on every build slot, a written HP readout, a header
repeating the lobby code mid-match. Each addition was individually reasonable and none was
ever asked for. Together they read as scaffolding rather than as a finished game, and they
work against the black-and-white 1930s cartoon direction, where a wall of UI copy is
precisely the wrong register.

The same habit applies beyond text. Features arrive because they seem obviously useful,
which is how a small game acquires a large surface nobody chose.

## Decision

**1. No text in the game world.** Outside the allowlist below, nothing renders words —
not labels, not hints, not explanations, not captions on buildings or waves. Where
something must be communicated, it is communicated with an **icon**, and icons are used
sparingly rather than as a replacement vocabulary for the sentences they displaced.

**2. Text is allowed only here** (granted explicitly; everything else is removed):

| Where | What |
|---|---|
| Main menu | Text as needed |
| Lobby screen | Text as needed, **including the 4-character lobby code** — it cannot be shared to join without being read |
| In match | The **name label above each player**; the **Metal and Energy readouts**; the **escape time on the end screen**; the words **`metal / s`** on the Metal-per-second box the Metal readout reveals (granted on request, [#105](https://github.com/ericbstie/the-game/issues/105)) |

Everything not in that table goes, including the controls hint, the HP label and downed
countdown, the build-slot names, and the in-match lobby-code header.

The Metal-per-second box needed no grant for its figure — that is another Metal number, and the
Metal readout was already allowed. Its unit did: a bare figure sliding out above the total reads
as a second total, and `metal / s` is the only thing that says the number is a rate. Granted by
explicit request in V2.0.

**3. Nothing is implemented that was not explicitly asked for.** Not features, not helpful
extras, not "while I was in there" additions. When something seems necessary but was not
requested, it is raised as a question or filed as an issue — never built on assumption. The
game grows by explicit addition, one deliberate piece at a time.

## Consequences

- Any information currently carried by a word must earn an icon or be dropped. Some will be
  dropped, and that is the intent — a state nobody asked to see does not need to be shown.
- New work starts from the smallest thing that satisfies the request. Adjacent improvements
  are proposed, not performed.
- This ADR is the standing default. Any exception is granted per-case and recorded — the
  table above is the record of the exceptions granted so far and is expected to grow only
  by explicit request.
- The visual direction that prompted this is recorded separately, with the rest of the
  Milestone 5 art decisions, in the tracker.
