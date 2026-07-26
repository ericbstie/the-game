---
name: implement
description: >-
  Orchestrator for building an agreed spec or ticket end to end with
  discipline. Invoke with /implement when a spec exists and you want it built:
  it sets the seam, models the domain, drives the work test-first, keeps the
  code minimal, and reviews before handing back.
disable-model-invocation: true
---

# Implement

Turn an agreed spec into working, reviewed code. This skill *sequences* the
engineering disciplines; it doesn't replace them.

## Order

1. **Claim the issue.** Comment that you are taking it, name your branch in that comment, and assign the author (CLAUDE.md, *Claiming an issue*). Do this before step 2, not after.
2. **Confirm the target.** Restate what "done" means for this spec in a sentence or two. If it's unclear, stop and sharpen it before writing code. Check the ticket's size label still fits what you now understand — if it doesn't, relabel it and say so on the issue.
3. **Design the seam** (`codebase-design`). Decide the module boundary and interface before touching implementation.
4. **Model the words** (`domain-modeling`). Name new concepts in the domain's language now, so the code is born with the right names.
5. **Build test-first** (`tdd`). Red → green → refactor, one behavior at a time, committing at each green.
6. **Stay minimal** (`yagni`). At every step take the lowest rung of the decision tree that fully solves the slice — least code, no speculative abstractions.
7. **Review** (`two-axis-review`). Check the change on both Standards and Spec before calling it done.
8. **Verify it runs.** Exercise the actual behavior (`/verify`), not just the tests, before handing back.

Stop and check in with the human at any point where the spec turns out to be
wrong or ambiguous. Building the wrong thing well is still building the wrong
thing.
