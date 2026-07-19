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
  mines, clusters, the door), or handling pixel-crisp rendering, sprite caching,
  atlases, or color variants, use this skill. Generate sprites procedurally in
  code (baked to offscreen canvases); the game ships no image assets.

A third skill, **`signal-only`**, is effectively always-on: on every turn,
write self-documenting code (comments only for *why*, never to restate the
code) and high-signal prose (lead with the answer; cut filler and hedging).

The remaining skills (`tdd`, `codebase-design`, `diagnosing-bugs`,
`domain-modeling`, `two-axis-review`, `research`, `prototype`,
`resolving-merge-conflicts`, the planning orchestrators `/wayfinder`,
`/to-spec`, and `/to-tickets`, and the `/implement` orchestrator) apply in their
matching situations. See the README's **Contribute** section for the order to
invoke them when building a feature.
