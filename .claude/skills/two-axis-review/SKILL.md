---
name: two-axis-review
description: >-
  Review a diff on two independent axes — Standards (is it well built?) and
  Spec (does it do what was asked?). Use when reviewing a pull request, a diff,
  or your own changes before committing. Reports concrete, ranked findings tied
  to specific lines, and separates must-fix from nice-to-have.
---

# Two-Axis Review

Judge a change on two questions that don't substitute for each other:

- **Standards** — is the code well built? Correctness, edge cases, error handling, naming, duplication, tests, security, and performance where it matters.
- **Spec** — does it do what was actually asked? Compare against the ticket, spec, or stated intent — not against what the code happens to do. Code can be immaculate and still solve the wrong problem.

Run both. A change ships only when it passes each.

## How to review

1. Read the intent first (spec, ticket, PR description). Know the target before judging the shot.
2. Walk the diff. On each hunk, ask both questions.
3. For every finding, give the file:line, what's wrong, why it matters, and a concrete fix. "This is confusing" isn't actionable; "rename `d` to `elapsedMs`; ms vs s is ambiguous here" is.
4. Rank findings: **must-fix** (bug, spec miss, security) above **should-fix** (clarity, duplication) above **nit** (style, taste). Label nits as nits so they don't block.
5. Verify the tests actually exercise the change. Green tests that don't touch the new path are theater.

## Tone

Be specific and kind. Review the code, not the author. When something is good, say so briefly — it tells the author what to keep doing.
