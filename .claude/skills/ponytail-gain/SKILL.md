---
name: ponytail-gain
description: >-
  Measure and report the gain from applying ponytail — code, dependencies, and
  tokens saved. Invoke with /ponytail-gain after a simplification or on a diff
  to quantify what was cut, so the value of writing less is concrete rather than
  assumed.
disable-model-invocation: true
---

# Ponytail Gain

Make "we wrote less" measurable. A number turns a vibe into evidence.

## Measure

- **Lines** — net lines removed vs a baseline (the pre-simplification version, or the naive approach you *didn't* take). `git diff --stat` gives the honest count.
- **Dependencies** — packages avoided or removed. Each one is install weight, attack surface, and upgrade toil saved.
- **Surface** — public functions, exports, and config options reduced. Less to learn, test, and keep working.
- **Tokens** — rough token delta of the code the agent must carry (fewer lines ≈ fewer tokens on every future read).

## Report

State the before/after and the delta for each dimension you measured, then one
honest sentence on the *quality* effect — simpler to read, or a real capability
traded away? Don't celebrate a cut that removed needed behavior; a smaller wrong
answer is not a win. If ponytail's expected gain here was near zero because the
code was already tight, say so plainly rather than manufacturing a number.
