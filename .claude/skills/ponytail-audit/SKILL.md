---
name: ponytail-audit
description: >-
  Audit existing code for over-engineering and dead weight against the ponytail
  ladder. Invoke with /ponytail-audit to scan a file, module, or diff and list
  concrete removals — unused abstractions, needless dependencies, code the
  stdlib or platform already provides — ranked by payoff.
disable-model-invocation: true
---

# Ponytail Audit

Point the ladder at code that already exists and find what shouldn't.

## What to flag

- **Abstractions with one caller.** An interface, factory, or wrapper used once is usually just indirection — inline it.
- **Reinvented wheels.** Hand-rolled code the stdlib or a native platform feature already does (date math, array ops, canvas transforms, DOM APIs).
- **Dependencies earning their weight in a few lines.** A whole package pulled in for one trivial helper.
- **Speculative generality.** Config, hooks, and parameters no caller uses; "flexible" code with exactly one shape.
- **Dead code.** Unreachable branches, unused exports, commented-out blocks.
- **Duplication** that a single well-named helper would collapse.

## Output

A ranked list. For each item: the file:line, what to remove or replace, the rung
of the ladder it violates, and the rough payoff (lines, deps, or tokens saved).
Put the highest-payoff, lowest-risk removals first. Recommend; don't delete
until the human okays the cut — some "unused" code is load-bearing in ways a
scan can't see.
