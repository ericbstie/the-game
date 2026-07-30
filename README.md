# Breakout Box

Co-op arena survival for the browser — 2–6 friends push out from the center of
one giant box to find the escape door and get the whole squad out, fast. Score
is your escape time. A React app rendered on an HTML5 canvas, built with Bun.
See [DESIGN.md](DESIGN.md).

## Run

Requires [Bun](https://bun.sh).

```sh
bun install
bun dev
bun test
bun test --watch
bun run typecheck
bun run check
bun run build
bun run sprite:sheet src/sprite/<name>.ts
bun run sprite:frame
bun run delta:size
bun run ore:seams
```

`bun run check` is lint, format **and** types — Bun strips types without checking them, so
`bun test` alone will run green on a tree `tsc` rejects.

Both `bun dev` (hot reload) and `bun serve` run the unified server in `server.ts` — one
process, one origin, serving the React app and the same-origin lobby WebSocket. `bun run
compile` builds the standalone server binary.

`bun run sprite:sheet` renders a sprite module to a PNG review sheet in headless Chromium, and
`bun run sprite:frame` renders a real frame of the game through `drawWorld` — no server needed.
The loop every sprite goes through is [docs/sprite-loop.md](docs/sprite-loop.md); the contract
each one is written against is [src/sprite/README.md](src/sprite/README.md).

`bun run ore:seams` measures whether an ore patch is seamless inside and ragged at its edge — the
two requirements a tiled sprite has to satisfy at once
([#87](https://github.com/ericbstie/the-game/issues/87)); the contract is in
[src/sprite/README.md](src/sprite/README.md).

`bun run delta:size` measures `game/map-delta` — the only message that rides continuously, and so
the game's bandwidth — at the caps the game supports. The baseline is
[docs/map-delta-budget.md](docs/map-delta-budget.md).

To demo a lobby across two networks, see [docs/cross-network-demo.md](docs/cross-network-demo.md).

## Contribute

**Plan (big or unclear work):** `/wayfinder` → `/to-spec` → `/to-tickets`, then build each ticket below.

**Claim first.** Before writing code for an issue, comment that you're taking it, name your
branch in that comment, and assign the author. Every issue carries one type label
(`feature` · `improvement` · `bug` · `investigation`), one size (`XS`–`XL`, measured by
blast radius — **never** by time). Work is tracked per version, and an issue's version is
its parent rather than a label of its own. Version 2.0
([#91](https://github.com/ericbstie/the-game/issues/91)) is closed, so the next version
needs its own tracking issue before new work can be filed. See [CLAUDE.md](CLAUDE.md).

**Build:**

1. `research` — verify anything unknown against real sources.
2. `domain-modeling` — name new concepts in the game's language.
3. `codebase-design` — set the module seam and interface.
4. `yagni` — decision tree before implementing; least code that solves it *(auto)*.
5. `tdd` — build it red → green → refactor.
6. `canvas-sprite-generation` — for any sprite or canvas art *(auto)*.
7. `two-axis-review` — review on Standards + Spec.
8. `/verify` — run the game; confirm it works.

Then commit. `/implement` chains steps 2–7 from an agreed spec.
