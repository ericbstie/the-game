# ADR 0001 — No prose in the game beyond what was asked for

- **Status:** Accepted — amended 2026-07-30
- **Date:** 2026-07-25; amended 2026-07-30
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

### What the first draft of this ADR got wrong

It was written as a **ban plus an allowlist**: no text in the game *world*, and a table in this
document naming every exception, each one granted by editing this file. Two things were wrong with
that, and both were read back out of it in practice.

It **policed the wrong axis.** Phrasing the rule around the game world made it sound like a rule
about *where* text is drawn — canvas versus DOM — and it was cited that way, including as an
argument for putting new copy in the DOM to stay clear of it. That was never the intent. Text on
the canvas is fine. The renderer was never the problem.

It made this document a **gate.** Every new string meant an edit here, which puts the decision in
two places and lets this file disagree with the ticket that actually made it.

## Decision

**1. No prose in the game that was not explicitly asked for.** The default is none. A sentence, a
label, a hint, an explanation earns its place by having been **requested in writing** — in a ticket,
an issue, or a written instruction — and by nothing else. "It seemed helpful", "the player will
need to know", and "while I was in there" are not requests.

**2. The ticket is the record.** There is no allowlist to edit and no permission to obtain here.
Text ships because an issue asked for it, and that issue is the provenance. If you cannot point at
the request, the answer is not to add it — it is to raise the question or file the issue.

**3. Where it renders is not the question.** Canvas and DOM are both fine, and this ADR takes no
position between them. That split is decided by what the thing *is* — screen-fixed chrome that
takes clicks is DOM, a mark anchored in the world and moving with the camera is canvas — and never
by this rule. Do not move copy into the DOM to get out from under this ADR; it does not reach
further into the canvas than it does into the HUD.

**4. Prefer an icon where an icon can say it.** A quantity needs a numeral and an identity often
needs a word, but most of what the old hint text carried is better drawn than written. This is a
preference and a design bias, not a gate — an icon that has to be explained is worse than the
sentence it replaced.

**5. Nothing is implemented that was not explicitly asked for.** Not features, not helpful extras,
not adjacent improvements. Prose is one instance of this rule, not a separate one. When something
seems necessary but was not requested, it is raised as a question or filed as an issue — never
built on assumption. The game grows by explicit addition, one deliberate piece at a time.

## What has been asked for so far

A record, not an allowlist. It is **non-exhaustive and not a gate** — nothing has to be added here
to ship, and a string missing from this table is not thereby refused. Each entry cites the request
that is its actual authority.

| Where | What | Asked for in |
|---|---|---|
| Main menu | Text as needed | — |
| Lobby screen | Text as needed, including the 4-character lobby code — it cannot be shared to join without being read | — |
| In match | The name label above each player; the Metal and Energy readouts; the escape time on the end screen | — |
| In match | `metal / s` on the Metal-per-second box | [#105](https://github.com/ericbstie/the-game/issues/105) |
| In match | On each build slot, its Metal cost as a numeral and its one-word name — `mine` · `generator` · `wall` · `turret` | [#98](https://github.com/ericbstie/the-game/issues/98) |
| In match | The `+1` a miner floats as it mines | [#99](https://github.com/ericbstie/the-game/issues/99) |
| In match | The same `+1` over an ore tile mined by hand | [#136](https://github.com/ericbstie/the-game/issues/136) |
| In match | On the ammo box, its spendable bullet count and the number queued in the corner circle | [#102](https://github.com/ericbstie/the-game/issues/102) |
| In match | The lettered sound effect struck where a shot connects and where an enemy dies — `POW` · `ZAP` · `BAM` · `BOP` | [#79](https://github.com/ericbstie/the-game/issues/79) |

The controls hint, the HP label, the downed countdown and the in-match lobby-code header were
removed under the original ADR because nobody had asked for any of them. That reasoning is
unchanged.

Two notes worth keeping from the first draft, because they are about the work rather than about
permission. The build-slot **name** and its **cost numeral** buy different things: the name gives
the sprite an identity the drawing cannot, and the numeral states a price the player could
otherwise learn only by being refused — which is what makes choosing between a 120 turret and a
150 generator a judgement rather than a guess. And the four lettered sound effects are **drawn
shapes, not typeset words**: each is a baked sprite of stroked letterforms in
`src/sprite/lettering.ts`, with no font and no composed string. A test in `src/game/draw.test.ts`
holds a lettered frame to adding no text draw at all. That test is an assertion about *how
lettering is built* — it is art, not typography — and not a mechanism for keeping prose out of the
canvas. Nothing about this ADR requires such a test for text that is simply written.

## Consequences

- **Provenance is the test.** Reviewing new copy means asking which ticket asked for it, not
  checking it against a list in this file. Copy with no request behind it comes out, wherever it
  renders.
- **This document stops being a bottleneck.** A feature that was asked for and includes text does
  not wait on an ADR edit. Adding its row above afterwards is bookkeeping, and optional.
- **Information carried by a word must still earn it.** Some will be dropped instead, and that is
  the intent — a state nobody asked to see does not need to be shown.
- **New work starts from the smallest thing that satisfies the request.** Adjacent improvements are
  proposed, not performed.
- The visual direction that prompted this is recorded separately, with the rest of the Milestone 5
  art decisions, in the tracker.
