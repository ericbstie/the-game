---
name: ponytail-debt
description: >-
  Track complexity debt — the over-engineering the ponytail ladder wants gone
  but that isn't safe to remove yet. Invoke with /ponytail-debt to record
  deletion candidates with their blockers, so the cruft stays visible and gets
  paid down deliberately instead of forgotten.
disable-model-invocation: true
---

# Ponytail Debt

Not every bit of excess can be cut today — something depends on it, or the cut
needs a test first. Debt you can see is debt you can pay; debt you forget
compounds.

## Record each item as

- **What** — the over-built thing (file:line, a one-line description).
- **Why it's debt** — which rung of the ladder it violates, and its cost (extra surface, tokens, a dependency, cognitive load).
- **Blocker** — what has to be true before it's safe to remove (a caller migrated, a test added, a feature confirmed dead).
- **Payoff** — what removing it buys.

## Keep it honest

- Put the list somewhere durable (a `DEBT.md` or the issue tracker), not just in chat — otherwise it evaporates.
- Revisit when a blocker clears, and pay the item down immediately while the context is fresh.
- Don't let "debt" become a graveyard for decisions you're avoiding. If an item sits untouched with no blocker, either cut it now or admit it's here to stay and delete the entry.
