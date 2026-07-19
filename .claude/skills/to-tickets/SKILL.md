---
name: to-tickets
description: >-
  Break a plan or spec into small tracer-bullet tickets with explicit blocking
  edges. Invoke with /to-tickets once a spec exists and you want it sequenced
  into buildable work — each ticket is a thin end-to-end slice that ships
  something real, and the dependencies between them are stated, not implied.
disable-model-invocation: true
---

# To-Tickets

A spec is one big thing; tickets are the order you actually build it. Slice for
*tracer bullets* — thin cuts that run end to end — not for horizontal layers.

## What makes a good ticket

- **A tracer bullet, not a layer.** Each ticket delivers a thin slice that works end to end (one enemy that spawns, moves, and can die) rather than a layer (all rendering, then all AI). Something runs early, so you learn early.
- **Small.** Finishable in one focused sitting. If you can't state its "done when" in a sentence, split it.
- **Independently verifiable.** It has an observable result you can check — not "set up the state machine" but "a grunt walks toward the nearest miner."
- **Named in the domain's language** (`domain-modeling`).

## Declare the edges

- For each ticket, state what **blocks** it — the tickets that must land first. Make dependencies explicit; unstated ones are discovered as breakage.
- Prefer a shape with few edges. A long dependency chain means no parallelism and a slow first result; if everything blocks on ticket #1, reconsider the slicing.
- Mark the **tracer** — the first thin slice that proves the whole path works end to end. Build it first.

## Output

Publish tickets to the issue tracker (GitHub issues here), each with its "done
when" and its blocking tickets listed (sub-issues, or a `blocked-by:` line for
the edges). Fall back to a checklist in `TICKETS.md` if there's no tracker. Then
build in dependency order — `/implement` per ticket.
