---
name: ponytail-review
description: >-
  Review a diff through the lazy-senior lens before it merges — could this have
  been less code without losing correctness? Invoke with /ponytail-review on a
  change to flag over-engineering, needless dependencies, and abstractions that
  don't pay for themselves, with a concrete leaner alternative for each.
disable-model-invocation: true
---

# Ponytail Review

Review the change for one question: is this the least code that fully solves the
problem? Correctness is assumed non-negotiable — you're reviewing *excess*, not
bugs (use `two-axis-review` for correctness).

## For each hunk, ask the ladder

- Did this need to be added at all, or does it serve a requirement nobody stated?
- Does it reimplement something already in the codebase, the stdlib, or the platform?
- Does it add a dependency a few lines would replace?
- Is there an abstraction here with exactly one caller that hides nothing?
- Could this block be meaningfully shorter without getting less correct?

## Output

For every finding: file:line, the excess, the ladder rung it skipped, and a
concrete leaner alternative ("replace this 30-line easing helper with the CSS
`transition` you already have"). Rank by payoff. Pass the change if it's already
tight — and say so; a clean "nothing to cut" is a real result, not a failure to
find something.
