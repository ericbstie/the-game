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

Work is organised by **version**. Each version has its own independent tracking issue,
and **every issue created in this repo must be a sub-issue of the current version's
tracking issue** — feature tickets, investigations and bugs alike. Nothing is created
as a top-level issue except a version tracker itself.

The current version is **[TRACKING] Breakout Box — Version 2.0**
([#91](https://github.com/ericbstie/the-game/issues/91)). File everything under it.

[#3](https://github.com/ericbstie/the-game/issues/3) is the **closed v1 record** —
milestones 1–5, how the game got here. Read it for history; never file new work under
it. A closed tracker cannot carry open work.

A version ships when its tickets are closed. Before opening the next one, close
**all** issues under the current version and fold anything deliberately left behind
into the new tracker, saying why it was left.

### Claiming an issue

**Before writing any code for an issue, do all three:**

1. **Comment on the issue saying you are taking it.**
2. **State the branch you are working on** in that same comment.
3. **Assign `ericbstie` to the issue.**

One comment covers 1 and 2. Do it the moment you pick the task up, not when you
finish — the point is that anyone reading the issue can tell it is claimed and where
the work is happening.

### Labels

Every issue carries **one type**, **one size**, and the label of the version it belongs
to (`version-2.0`, …).

| Type | When |
| --- | --- |
| `feature` | A capability that does not exist yet. |
| `improvement` | Something that already works, made better — tuning, legibility, ergonomics. |
| `bug` | Behaviour that is wrong against its own spec. |
| `investigation` | Produces a decision or a measurement, not shipped behaviour. |
| `spec` · `decision` · `chore` · `performance` | Use where one of them fits better than the four above. |

`deferred` is orthogonal: it marks work that is wanted but not chartered, and sits
*alongside* a type rather than replacing one.

Version tracking issues take **no type and no size**. They are containers, and a
container has no blast radius of its own.

### Sizing — never in time

Sizes are **XS · S · M · L · XL**. They measure **blast radius and unknowns**: how many
places have to change together, and how much you cannot see from outside the work when
you start it.

| Size | Shape |
| --- | --- |
| `XS` | One constant, one call site. The diff explains itself. |
| `S` | One module, one behaviour. Existing tests stretch to cover it. |
| `M` | Several modules, or one module plus the wire shape it implies. New tests, no new architecture. |
| `L` | An assumption baked into many call sites, or a new subsystem with its own state. Needs a measurement or a recorded decision before it can close. |
| `XL` | Spans client, server and wire at once, or still carries an open design question. Look for the split first; if it genuinely cannot be split, say why in the body. |

**Never estimate in time.** Not hours, days, sittings, sessions or sprints — not in an
issue, a comment, a plan, a commit message, or a reply. A size is a claim about the
shape of the work, and the code can confirm or refute it. A duration is a claim about
the future that nobody can check and everybody remembers.

If the work turns out bigger than its label, **change the label and say so on the issue**.
A size that is only ever set once is decoration.

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
