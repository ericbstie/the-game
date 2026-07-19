---
name: domain-modeling
description: >-
  Build and sharpen the project's shared vocabulary so code, docs, and
  conversation use the same words for the same things. Use when a term is
  ambiguous or overloaded, when naming a new concept, or when the same idea has
  two names. Names in code should match the domain's ubiquitous language.
---

# Domain Modeling — ubiquitous language

Confused names are confused thinking that compiles. One concept, one name,
everywhere: conversation, docs, and code.

## Practice

- Name the real concepts of the domain, then make the code use those exact names. In this game: *nest*, *cluster*, *bank*, *miner*, *arc*, *escape door* — not `spawner2`, `resourceThing`, `store`.
- One word per concept, one concept per word. If "wave" means both the timed spawn event and the group of enemies it sends, split them; overloading is where bugs hide.
- When you meet an ambiguous or missing term, resolve it explicitly and write it down. A short glossary of load-bearing terms is cheaper than the confusion it prevents.
- Prefer the domain's word over a technical synonym. `escapeTimeMs` beats `score` if the domain calls it escape time.
- When the model changes, rename in the same change. A name that no longer matches the concept is a lie the reader will trust.

Keep the glossary near the design doc. When a new term earns its place, add it there first, then use it in code.
