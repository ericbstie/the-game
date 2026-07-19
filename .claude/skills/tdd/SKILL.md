---
name: tdd
description: >-
  Test-driven development with a strict red-green-refactor loop. Use when
  implementing new behavior, fixing a bug that deserves a regression test, or
  changing logic that must stay verifiable. Write a failing test first, make it
  pass with the least code, then refactor — never write implementation before a
  failing test exists.
---

# Test-Driven Development

Work in a tight red → green → refactor loop. One behavior at a time.

## The loop

1. **Red.** Write the smallest test that captures the next slice of behavior. Run it. Watch it fail for the *expected* reason — a test that has never failed proves nothing.
2. **Green.** Write the least code that makes it pass. Hardcoding a return value is fine here; the next test forces you to generalize.
3. **Refactor.** With the bar green, clean up names, duplication, and structure. Keep the tests green the whole time.

Commit at green. Each commit is a working step.

## Rules

- No production code without a failing test that demands it. If you can't write the test, you don't yet understand the behavior — stop and clarify it.
- Test behavior through the public interface, not private internals. Tests coupled to implementation break on every refactor and stop protecting you.
- One logical assertion per test; name the test after the behavior it pins (`returns_empty_bank_before_first_harvest`), not the method.
- A bug is a missing test. Reproduce it with a failing test first, then fix.
- Keep the loop fast. A slow suite kills the discipline, so a slow suite is the next problem to solve.
