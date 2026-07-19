# Skills

Project skills for Breakout Box. Each lives in `<name>/SKILL.md` and is
discovered automatically by Claude Code. Skills marked **auto** load themselves
when their description matches the task; skills marked **/cmd** are invoked by
name (they set `disable-model-invocation: true`).

## Engineering disciplines
*Inspired by [mattpocock/skills](https://github.com/mattpocock/skills).*

| Skill | Invoke | Purpose |
| --- | --- | --- |
| `tdd` | auto | Red → green → refactor loop; test first. |
| `codebase-design` | auto | Deep modules, small interfaces, clean seams. |
| `diagnosing-bugs` | auto | Reproduce → minimize → hypothesize → fix → verify. |
| `domain-modeling` | auto | One name per concept; ubiquitous language. |
| `two-axis-review` | auto | Review on Standards + Spec. |
| `research` | auto | Answer against primary sources, with citations. |
| `prototype` | auto | Throwaway spike to answer one design question. |
| `resolving-merge-conflicts` | auto | Resolve conflicts hunk-by-hunk for intent. |
| `implement` | /implement | Orchestrator: chains the above from a spec. |

## Least code

| Skill | Invoke | Purpose |
| --- | --- | --- |
| `yagni` | auto | Decision tree + YAGNI before implementing; least code that solves it. |

## Always-on communication

| Skill | Invoke | Purpose |
| --- | --- | --- |
| `signal-only` | auto | Self-documenting code and terse, high-signal prose on every turn. |

## Project-specific

| Skill | Invoke | Purpose |
| --- | --- | --- |
| `canvas-sprite-generation` | auto | Procedural 2D sprites baked to offscreen canvases. |
