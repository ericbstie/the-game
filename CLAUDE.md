# Breakout Box

Co-op arena survival game for the browser — a React app rendered on an HTML5
canvas, built and tested with Bun. See [DESIGN.md](DESIGN.md) for the full design.

## Before implementing

Reuse before you build. Before writing non-trivial code, adding a dependency, or
introducing an abstraction, **always dispatch a Haiku subagent to research existing
solutions first** — the standard library, native platform features, and
already-installed deps — and prefer whatever it finds that fits. This pairs with the
`yagni` skill below.

## Commits

Semantic commit messages (Conventional Commits) must be followed — `type: subject`
(`feat:`, `fix:`, `perf:`, `chore:`, `docs:`, …). Release versions are derived from
them automatically: `feat` bumps the minor, `fix`/`perf` the patch, and a `!` or
`BREAKING CHANGE:` footer the major (see `.github/workflows/release.yml`).

## Issue tracking

Work is tracked **per version**. Each version has its own tracking issue, and that issue
is the root — it is not nested under anything. **Every issue created in this repo must be
a sub-issue of the current version's tracking issue** — milestone breakdowns, feature
tickets, and bugs alike. The one exception is a deferred issue, below.

- **Current: [TRACKING] Breakout Box — Version 2.0**
  ([#91](https://github.com/ericbstie/the-game/issues/91)), label `version-2.0`.
- [#3](https://github.com/ericbstie/the-game/issues/3) is the **historical record for
  v1** — milestones 1–5, closed and complete. Read it for how the game got here; never
  file new work under it.

When a version ships, close its tracking issue and open the next one. That new issue
becomes the root for everything after it.

Work advances one milestone at a time, in order. Each `/wayfinder` → `/implement`
loop targets only the next open milestone and goes no further. Before advancing to
the next milestone, close **all** issues for the current milestone and **refine every
remaining milestone** to reflect how the scope changed while implementing the current
one.

### Deferred issues

A **deferred** issue is one that has been captured but not prioritised into a version —
an idea worth keeping, with no commitment to build it. It is the one exception to the
sub-issue rule: **a deferred issue is an orphan — top-level, no parent — until it is
prioritised.** Being prioritised is exactly what gives it a parent, so attach it to the
version tracking issue that picks it up at that moment and not before.

This keeps a version's tree an honest picture of what that version is actually doing.
Parking an unscheduled idea under a version implies a commitment that has not been made.

## Skills — use these when relevant

This repo ships engineering skills in `.claude/skills/`. Two of them are
**auto-invoked and must be applied whenever they are relevant**, not only when
asked:

- **`yagni`** — before writing or generating any code, adding a dependency, or
  introducing an abstraction, climb the decision tree (does this need to exist?
  → reuse? → stdlib? → native platform feature? → installed dep? → one line?)
  and write the least code that fully solves the problem. This prevents
  over-engineering. It never overrides correctness, validation, error handling,
  security, or accessibility.
- **`canvas-sprite-generation`** — whenever creating, drawing, or animating
  sprites or entity art (player, grunts, elites, nests, miners, walls, turrets,
  generators, ore, the door), or handling pixel-crisp rendering, sprite caching,
  atlases, or color variants, use this skill. Generate sprites procedurally in
  code (baked to offscreen canvases). Shipping no image assets is the strong
  preference but **no longer a hard rule** — see `docs/adr/0002`.

A third skill, **`signal-only`**, is effectively always-on: on every turn,
write self-documenting code (comments only for *why*, never to restate the
code) and high-signal prose (lead with the answer; cut filler and hedging).

The remaining skills (`tdd`, `codebase-design`, `diagnosing-bugs`,
`domain-modeling`, `two-axis-review`, `research`, `prototype`,
`resolving-merge-conflicts`, the planning orchestrators `/wayfinder`,
`/to-spec`, and `/to-tickets`, and the `/implement` orchestrator) apply in their
matching situations. See the README's **Contribute** section for the order to
invoke them when building a feature.
