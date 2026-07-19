---
name: research
description: >-
  Investigate a question against primary sources and capture cited findings.
  Use when an answer depends on facts you're unsure of — an API's real behavior,
  a spec, library semantics, or a design precedent — rather than guessing from
  memory. Prefer authoritative sources and record what was found with links.
---

# Research — primary sources, cited findings

An answer you can't cite is a guess wearing a confident tone. When the cost of
being wrong is real, go to the source.

## Method

1. State the question precisely, and what would count as an answer. "Does `requestAnimationFrame` fire when the tab is hidden?" beats "how does rAF work."
2. Go to primary sources first: official docs, the spec, the actual source, the changelog. Blog posts and forum answers are leads, not evidence — verify them against the primary source.
3. When sources disagree, prefer the most authoritative and most recent, and note the conflict rather than silently picking one.
4. Confirm behavior by running it when you can. A three-line repro settles "does it actually do X" faster than more reading.
5. Capture findings with links: the claim, the source, and the date. A finding without a source can't be rechecked and will be re-litigated.

## Output

Report the answer first, then the evidence. Separate what the sources say from
what you infer. Flag anything you couldn't verify as open, so a reader knows
where the confidence ends.
