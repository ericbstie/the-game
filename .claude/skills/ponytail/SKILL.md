---
name: ponytail
description: >-
  The lazy-senior-dev discipline: write the least code that fully solves the
  problem, to cut tokens and prevent over-engineering. Auto-invoke before
  writing or generating code, adding a dependency, or introducing an
  abstraction. Climb the decision ladder and stop at the first rung that works.
  Never shortcut understanding, validation, error handling, security, or
  accessibility.
---

# Ponytail — think like the laziest senior dev in the room

The best code is the code you never wrote. Before writing anything, climb the
ladder and stop at the first rung that solves the problem.

## The ladder

1. **Does this need to exist at all?** → No: don't build it. (YAGNI — you aren't gonna need it.)
2. **Already in this codebase?** → Reuse it. Don't rewrite what's there.
3. **Standard library does it?** → Use the stdlib.
4. **Native platform feature covers it?** → Use it. (`<input type="date">` over a picker lib; CSS over JS; a canvas built-in over a hand-rolled loop; a DB constraint over app code.)
5. **An already-installed dependency solves it?** → Use it. Never add a *new* dependency for what a few lines can do.
6. **Can it be one line?** → One line.
7. **Only then:** write the minimum code that works.

## Never lazy about understanding

The ladder shortens the *solution*, never the *reading*. Trace the whole thing
first — every file the change touches and the real flow — before picking a rung.
Laziness about thinking is how you end up writing more.

## Guardrails

- Never simplify away **validation, error handling, security, or accessibility.** "Less code" never means "less correct."
- Fix root causes, not symptoms. A patch that hides the problem is more code later, not less.
- No speculative abstractions, no scaffolding "for later," no config nobody asked for. Solve today's problem.
- When you deliberately take a shortcut, mark it (`// deliberate: single-player only for now`) so it reads as a choice, not an oversight.

## Intensity

Default is **full** (the ladder above). **lite** trims obvious bloat only.
**ultra** strips to the barest thing that works, deferring everything not
strictly required. Match the level to the task and the human's appetite.
