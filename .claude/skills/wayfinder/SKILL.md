---
name: wayfinder
description: >-
  Plan large, uncertain, multi-session work by mapping it into investigation
  tickets before any implementation. Invoke with /wayfinder when a task is too
  big or too unknown to spec directly — it surfaces the open questions, turns
  each into a small investigation that ends in a decision, and orders them by
  what unblocks the most.
disable-model-invocation: true
---

# Wayfinder

Big work fails when you plan the build before you understand the terrain. When a
task spans many sessions and carries real unknowns, don't spec it yet — chart
it. Turn the unknowns into investigations that each end in a decision.

## Process

1. **State the destination.** One or two sentences on what "done" looks like for the whole effort. If you can't, that's the first investigation.
2. **List the unknowns.** Everything you'd have to guess to write a spec today: unproven approaches, external systems, performance risks, design forks. Name them plainly.
3. **Turn each unknown into an investigation ticket.** Each one:
   - asks a single answerable question ("can host-authoritative netcode hold 6 players at <100ms?"),
   - names the output that settles it (a prototype result, a benchmark, a doc, a decision),
   - is small enough to finish in one session.
4. **Order by leverage.** Do the investigation that unblocks the most — or could kill the effort earliest — first. Cheap experiments that might invalidate the whole plan go to the front.
5. **Publish** the investigations to the issue tracker (GitHub issues here), each labelled as an investigation, with its question and "done when" in the body. If there's no tracker, write them to a `PLAN.md`.

## Rules

- Investigations produce *decisions and knowledge*, not features. When one ends, record the answer where the next session can find it (`research` captures it with sources).
- Re-chart as you learn. Answers spawn new unknowns and retire old ones; keep the map current rather than following a stale plan.
- Stop wayfinding once the remaining work is knowable — then hand off to `/to-spec` and `/to-tickets`.
