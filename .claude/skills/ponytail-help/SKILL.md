---
name: ponytail-help
description: >-
  Explain how the ponytail skills work — the decision ladder, the intensity
  levels, the guardrails, and when each ponytail command applies. Invoke with
  /ponytail-help for a quick reference or to decide which ponytail skill fits
  the situation.
disable-model-invocation: true
---

# Ponytail Help

Quick reference for the ponytail family.

## The idea

Write the least code that fully solves the problem. Fewer lines mean fewer bugs,
fewer tokens, and less to maintain — *without* cutting correctness.

## The ladder (from `ponytail`)

Exist? → reuse? → stdlib? → native platform feature? → installed dep? → one
line? → minimum that works. Stop at the first rung that solves it.

## The skills

- **`ponytail`** — always-on discipline; climbs the ladder before writing code.
- **`/ponytail-audit`** — scan existing code or a diff for over-engineering to remove.
- **`/ponytail-debt`** — record over-built code that can't be cut yet, with blockers.
- **`/ponytail-gain`** — measure lines, deps, and tokens saved by a simplification.
- **`/ponytail-help`** — this reference.
- **`/ponytail-review`** — review a diff through the lazy-senior lens before merge.

## Intensity

**lite** trims obvious bloat · **full** runs the whole ladder (default) ·
**ultra** strips to the barest working thing.

## The one rule that overrides all others

Never lazy about *understanding*, and never simplify away validation, error
handling, security, or accessibility.
