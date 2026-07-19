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

1. **Confirm the target.** Restate what "done" means for this spec in a sentence or two. If it's unclear, stop and sharpen it before writing code.
2. **Design the seam** (`codebase-design`). Decide the module boundary and interface before touching implementation.
3. **Model the words** (`domain-modeling`). Name new concepts in the domain's language now, so the code is born with the right names.
4. **Build test-first** (`tdd`). Red → green → refactor, one behavior at a time, committing at each green.
5. **Stay lazy** (`ponytail`). At every step take the lowest rung of the ladder that fully solves the slice — least code, no speculative abstractions.
6. **Review** (`two-axis-review`). Check the change on both Standards and Spec before calling it done.
7. **Verify it runs.** Exercise the actual behavior (`/verify`), not just the tests, before handing back.

Stop and check in with the human at any point where the spec turns out to be
wrong or ambiguous. Building the wrong thing well is still building the wrong
thing.
