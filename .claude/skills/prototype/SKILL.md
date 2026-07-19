---
name: prototype
description: >-
  Build a throwaway prototype to answer a specific design or feasibility
  question fast. Use when the right approach is unclear and cheaper to learn by
  building than by arguing. Optimize for learning, not for keeping — the
  deliverable is the answer, and the code is expected to be deleted.
---

# Prototype — spike to learn, then throw it away

A prototype exists to answer one question ("will host-authoritative netcode feel
responsive enough at 6 players?"), not to become the feature.

## Rules

- Write the question down first, and the smallest thing that would answer it. If you can't say what you're trying to learn, you're not prototyping — you're wandering.
- Cut every corner that doesn't bear on the question: skip error handling, tests, edge cases, and polish. Hardcode inputs. Fake the parts that aren't under study.
- Timebox it. A prototype that runs for days has quietly become production code without the care production needs.
- Keep it in a scratch file or branch, clearly marked throwaway, so it can't leak into the real build.
- When you have the answer, **write it down** (what you learned, what you'd do), then delete or archive the code. The learning is the asset; the code is scaffolding.
- If the prototype must become real, rebuild it properly (with `tdd`) rather than promoting the spike. Prototype code carries none of the guarantees production needs.
