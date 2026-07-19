---
name: resolving-merge-conflicts
description: >-
  Work through git merge or rebase conflicts hunk-by-hunk, preserving the
  intent of both sides. Use when a merge, rebase, or cherry-pick stops with
  conflicts. Resolve each hunk deliberately, keep the code compiling, and verify
  with tests before completing the merge.
---

# Resolving Merge Conflicts

A conflict is two intents that touched the same lines. Resolve for *intent*, not
by picking a side blindly.

## Process

1. Understand what happened. `git status` for the conflicted files; `git log --merge -p <file>` to see both sides' changes and *why* each was made.
2. Take conflicts one hunk at a time. For each: what was each side trying to do, and what result honors both? Usually you want both changes merged — not one deleted.
3. Never resolve by reflex. `--ours`/`--theirs` on a whole file silently drops the other side's work. Reach for them only when you're certain one side fully supersedes the other.
4. After each file, remove every conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`) and make sure the result reads as if one author wrote it.
5. Build and run the tests before committing the merge. A merge that compiles can still be semantically broken where two correct changes combine into a wrong one.
6. If a conflict is beyond your understanding of the intent, stop and ask the author of one side rather than guessing.

## After

Keep the merge commit message honest about any non-trivial resolution you made,
so the next reader knows a judgment call happened here.
