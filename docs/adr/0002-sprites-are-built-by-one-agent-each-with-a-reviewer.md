# ADR 0002 — Every sprite is built by its own agent, reviewed by another, on a harness built first

- **Status:** Accepted
- **Date:** 2026-07-25
- **Applies to:** all sprite and UI art from Milestone 5 onward

## Context

Milestone 5 replaces every shape in the game with drawn art in a specific and unforgiving
style: 1930s rubber-hose cartoon, black and white, orthographic, at sizes as small as 28
pixels. A single pass over a long list of sprites produces drift — the tenth sprite stops
matching the first, frames within one animation stop matching each other, and the generated
output carries small artefacts that are obvious on inspection and invisible to whoever
produced them.

Art also cannot be verified by a test suite. `bun test` can assert that a draw call happened;
it cannot say whether the drawing looks like the thing it is meant to be, or whether two
frames of a walk cycle move naturally between each other. That has to be *looked at*.

## Decision

**1. One agent per sprite.** Each unique sprite is produced by its own subagent, which owns
**all** of that sprite's frames and variants — every facing, every animation frame, every
state. Nothing spans two agents, so consistency within a sprite is one agent's
responsibility.

**2. Every sprite agent spawns a reviewer.** The producing agent must spawn a separate
subagent to **visually** review the result. The reviewer checks:

- that it reads as **1930s New York cartoon / magazine** work;
- **artefacts** of any kind, including the tell-tale artefacts of generated imagery;
- **consistency between frames**, and whether the movement between them looks natural.

**3. The reviewer is advisory, not blocking.** Its findings are recorded and travel with the
sprite; the sprite is not held back until it passes. The final call is the author's, made by
looking at the work in the game.

**4. The harness is built before any sprite is.** A separate piece of work refines the
generation-and-review loop first, and stands up whatever tooling it needs — both to
**visually verify** a sprite and, if procedural drawing cannot reach the required quality, to
**produce** sprites by another means.

**5. Verify; never bypass.** When something cannot be verified, the answer is to build the
tool that verifies it — not to proceed unverified, and not to weaken the goal until the
existing tools happen to cover it.

**6. Prefer existing tools.** Reach for what is already installed or already native to the
platform. Add a tool only when verification is otherwise impossible **and** the thing being
verified is genuinely required in exactly that form, with no workable alternative.

**7. The no-asset rule is now soft.** The project has shipped no image assets, and procedural
drawing remains the default and the preference. But if procedural drawing cannot reach the
style, the harness may produce committed assets instead. Quality of the result outranks
purity of the method.

**8. The UI is one agent.** All user interface — every screen out of match and the in-match
HUD alike — is produced by a single agent, reviewed by the same process against
UI-focused criteria rather than sprite criteria.

## Consequences

- Milestone 5 begins with tooling, not art. No sprite is drawn until the loop that produces
  and inspects it exists.
- Sprite work fans out widely — roughly a dozen producing agents, each with a reviewer.
- The project may acquire an asset pipeline it has so far avoided. That is accepted, and it
  is a last resort rather than a starting point.
- Review notes are part of a sprite's deliverable, so the author reviews the art already
  knowing what its own reviewer flagged.
