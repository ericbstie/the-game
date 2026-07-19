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
bun run check
bun run build
```

Both `bun dev` (hot reload) and `bun serve` run the unified server in `server.ts` — one
process, one origin, serving the React app and the same-origin lobby WebSocket. `bun run
compile` builds the standalone server binary.

To demo a lobby across two networks, see [docs/cross-network-demo.md](docs/cross-network-demo.md).

## Contribute

**Plan (big or unclear work):** `/wayfinder` → `/to-spec` → `/to-tickets`, then build each ticket below.

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
