import type { MatchOutcome } from "../lobby/protocol";

// The match is over. Score is elapsed time, and that is the whole of it — no leaderboard and
// nothing persisted, per the milestone's scope.

interface EndScreenProps {
  outcome: MatchOutcome;
  elapsedMs: number;
  onLeave: () => void;
}

// Win and loss read distinctly — same layout, opposite verdict.
const COPY: Record<MatchOutcome, { title: string; detail: string; timeLabel: string }> = {
  escaped: {
    title: "Escaped",
    detail: "The whole squad made it out of the box.",
    timeLabel: "Escape time",
  },
  wiped: {
    title: "Wiped",
    detail: "The whole squad went down. The box keeps this one.",
    timeLabel: "Survived for",
  },
};

export function EndScreen({ outcome, elapsedMs, onLeave }: EndScreenProps) {
  const copy = COPY[outcome];
  return (
    // #81 settled that the end screen is a *screen*, not the match: the in-match allowlist grants
    // the running escape countdown, not this. So the verdict, the detail and the button all stay,
    // set as magazine typography like the menu and the lobby.
    <main className="end sheet" data-outcome={outcome}>
      <p className="kicker">The Verdict</p>
      <h1>{copy.title}</h1>
      <p className="end-detail">{copy.detail}</p>
      <p className="end-time">
        <span className="end-time-label">{copy.timeLabel}</span>
        <strong>{formatElapsed(elapsedMs)}</strong>
      </p>
      <button type="button" onClick={onLeave}>
        Back to menu
      </button>
    </main>
  );
}

// `m:ss.t` — tenths matter when the score is a race against your own previous run.
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, elapsedMs);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
