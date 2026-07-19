# Breakout Box

Co-op arena survival game for the browser. Single-file HTML/JS canvas, no build
step. See [DESIGN.md](DESIGN.md) for the full design.

## Skills — use these when relevant

This repo ships engineering skills in `.claude/skills/`. Two of them are
**auto-invoked and must be applied whenever they are relevant**, not only when
asked:

- **`ponytail`** (and its `/ponytail-*` commands) — before writing or generating
  any code, adding a dependency, or introducing an abstraction, climb the
  ponytail decision ladder and write the least code that fully solves the
  problem. This saves tokens and prevents over-engineering. It never overrides
  correctness, validation, error handling, security, or accessibility.
- **`canvas-sprite-generation`** — whenever creating, drawing, or animating
  sprites or entity art (player, grunts, elites, nests, miners, walls, turrets,
  mines, clusters, the door), or handling pixel-crisp rendering, sprite caching,
  atlases, or color variants, use this skill. Generate sprites procedurally in
  code (baked to offscreen canvases); this project has no asset pipeline.

The remaining skills (`tdd`, `codebase-design`, `diagnosing-bugs`,
`domain-modeling`, `two-axis-review`, `research`, `prototype`,
`resolving-merge-conflicts`, and the `/implement` orchestrator) apply in their
matching situations. See the README's **Contribute** section for the order to
invoke them when building a feature.
