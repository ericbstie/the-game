import type { MatchOutcome } from "../lobby/protocol";

// The match is over. Score is elapsed time, and that is the whole of it — no leaderboard and
// nothing persisted, per the milestone's scope.

interface EndScreenProps {
  outcome: MatchOutcome;
  elapsedMs: number;
  onLeave: () => void;
}

export function EndScreen({ outcome, elapsedMs, onLeave }: EndScreenProps) {
  return (
    <main className="end" data-outcome={outcome}>
      <h1>Escaped</h1>
      <p className="end-detail">The whole squad made it out of the box.</p>
      <p className="end-time">
        <span className="end-time-label">Escape time</span>
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
