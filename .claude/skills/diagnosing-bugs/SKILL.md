---
name: diagnosing-bugs
description: >-
  Structured debugging loop — reproduce, minimize, hypothesize, instrument,
  fix, verify. Use when a bug's cause isn't obvious, behavior is intermittent,
  or a first fix attempt failed. Confirm the root cause before changing code;
  never ship a guess.
---

# Diagnosing Bugs

Guess-patching wastes time and hides the real defect. Find the cause, then fix
it once.

## Loop

1. **Reproduce.** Get a deterministic repro — exact steps, inputs, and environment. An intermittent bug you can't trigger on demand is a bug you can't confirm you fixed.
2. **Minimize.** Strip the repro to the smallest case that still fails. Each thing you remove that *doesn't* change the outcome is a suspect eliminated.
3. **Hypothesize.** State a specific, falsifiable cause: "X is null because Y runs before Z." Vague hunches ("something with state") aren't testable.
4. **Instrument.** Add a log, assertion, or breakpoint that would prove the hypothesis true or false. Run it. Let the evidence decide, not intuition.
5. **Fix the cause.** Change the thing that is actually wrong, not the nearest symptom. If the fix doesn't map to a confirmed cause, you're back to guessing.
6. **Verify.** Confirm the original repro now passes, and add a regression test so this exact bug can't return silently.

## Habits

- Read the whole error and stack trace before touching code. The answer is often already there.
- Change one variable at a time. Change two at once and you learn nothing from the result.
- If you're stuck, the assumption you haven't questioned is usually the wrong one. List what you're *sure* of and check the cheapest item.
- Bisect: last known-good state vs now. `git bisect` turns "somewhere in 200 commits" into ~8 checks.
