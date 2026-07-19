---
name: to-spec
description: >-
  Synthesize a conversation or a pile of decisions into a single clear
  specification, then publish it. Invoke with /to-spec once the what and why are
  settled and you want them captured before building — it states the problem,
  the agreed behavior, scope, and open questions in one document on the issue
  tracker.
disable-model-invocation: true
---

# To-Spec

A conversation is decisions scattered across a hundred messages; a spec is those
decisions in one place a builder can act on. Turn one into the other.

## Produce a spec with these sections

- **Problem** — what we're solving and why it matters. One paragraph. If it needs three, the problem isn't clear yet.
- **Behavior** — what the thing does, from the user's side, in the domain's language (`domain-modeling`). Concrete and testable: inputs, outputs, and what the user sees.
- **In scope / out of scope** — draw the line explicitly. Naming what you're *not* doing prevents the most expensive misunderstandings.
- **Constraints** — anything the solution must respect (platform, performance, an existing seam).
- **Open questions** — every decision still unmade. A spec that hides its unknowns just moves the surprise to build time.

## Rules

- Capture what was *decided*, not every option discussed. The spec is the conclusion, not the transcript.
- Write behavior, not implementation. "The squad escapes only when all members are at the door" belongs here; "use a Set of playerIds" does not.
- If a decision was never actually made, list it under open questions rather than inventing one — then resolve the open questions before building.
- Publish to the issue tracker (GitHub issues here) as one spec issue; fall back to a `spec/<name>.md` doc if there's no tracker. Link the source discussion.

Hand a finished spec to `/to-tickets` to break it into buildable work.
