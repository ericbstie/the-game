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
a sub-issue of the current version's tracking issue** — feature tickets, investigations
and bugs alike. The one exception is a deferred issue, below.

- [#141](https://github.com/ericbstie/the-game/issues/141) is the **current version's
  root** — Version 3.0. New issues file under it unless deliberately scheduled further
  out (below) or `deferred`.
- [#143](https://github.com/ericbstie/the-game/issues/143) is the **next-version
  tracker** — Version 4.0, open alongside the current one.
- [#91](https://github.com/ericbstie/the-game/issues/91) is the **historical record for
  v2.0** — 37 sub-issues, closed and complete, released as v2.28.0. Its closing note
  carries what shipped, what was dropped, and what was left unmeasured.
- [#3](https://github.com/ericbstie/the-game/issues/3) is the **historical record for
  v1** — milestones 1–5, closed and complete. Read both for how the game got here; never
  file new work under either. A closed tracker cannot carry open work.

**One next-version tracker may be open alongside the current one.** It holds work that
is committed but scheduled after the current version — a real charter, not a parking
lot; an idea with no commitment stays `deferred`. Work on the current version first;
its tree is what ships next. Two open trackers is the ceiling — anything further out
than next has no business being scheduled yet.

When a version ships, close its tracking issue. The next-version tracker — opened then,
or already open — becomes the current root. Fold anything deliberately left behind into
it, saying why it was left.

### Writing an issue — the author's stance, and nothing else

An issue states **what was asked for** and **how the result gets checked**. It does not
design the solution. Keep it short and exact: the implementing agent is capable, and the
ticket's job is to bound the work, not to do it.

Write only:

- **The ask**, in the author's words and at the author's level of detail.
- **Verification** — the interface, and the checks that decide when it is done.
- **Constraints that already exist** — an ADR, a wire format, a seam in the code. Cite
  these `file:line` so they can be checked rather than trusted.
- **Open questions** — anything the author has not taken a stance on. Ask it and leave
  it unanswered.

Never:

- **Invent a requirement.** A default you chose, a threshold you picked, a behaviour you
  think is sensible — none of these are the ask. If the ticket cannot be built without
  one, that is an open question, not a decision you get to make.
- **Prescribe an implementation** that was not asked for. No suggested data structures,
  no recommended approach, no "do it this way". The agent picks.
- **Guess at a number.** "Something in the 60–120 ms range" is an invention. Ask.
- **Pad with rationale.** Do not re-argue the design or restate its consequences. It was
  asked for; that is enough.

This governs rewriting and triaging existing issues too, not just new ones. An issue that
says less is not weaker — everything added that the author never said is a claim someone
will later mistake for a decision.

### Balance numbers are provisional until they have been played

A number only a played match can judge — a cost, a rate, an HP, a spawn timing, a damage
value — is **provisional**. Write down the current value, say it is provisional, and move
on. Do not hold a ticket open waiting for it to be justified, and do not press for a better
one before anyone can play it. Arbitrary is fine; a number that has been played and kept is
worth more than a number argued about.

A **later change to one of these is a retune, not a correction** — nobody was wrong.

This does not cover numbers the code fixes: a wire size, a cadence floor, an existing
constant a feature has to match, a value derived from another. Those are constraints, and
they are cited rather than chosen.

### Claiming an issue

**Before writing any code for an issue, do all three:**

1. **Comment on the issue saying you are taking it.**
2. **State the branch you are working on** in that same comment.
3. **Assign `ericbstie` to the issue.**

One comment covers 1 and 2. Do it the moment you pick the task up, not when you
finish — the point is that anyone reading the issue can tell it is claimed and where
the work is happening.

### Labels

Every issue carries **one type** and **one size**.

| Type | When |
| --- | --- |
| `feature` | A capability that does not exist yet. |
| `improvement` | Something that already works, made better — tuning, legibility, ergonomics. |
| `bug` | Behaviour that is wrong against its own spec. |
| `investigation` | Produces a decision or a measurement, not shipped behaviour. |
| `spec` · `decision` · `chore` · `performance` | Use where one of them fits better than the four above. |

`deferred` is orthogonal: it marks work that is wanted but not chartered, and sits
*alongside* a type rather than replacing one. It also changes where the issue lives —
see **Deferred issues** below.

A **version label** (`version-2.0`, …) belongs to that version's tracking issue *only*.
An issue's version is its parent — being a sub-issue is what puts it in the version — so
repeating the label on every ticket only creates a second source of truth that can
disagree with the tree.

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
