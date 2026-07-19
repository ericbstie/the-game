import type { LobbySnapshot, ServerMessage } from "./protocol";

// Fold a server message into the local roster snapshot. Full-snapshot messages
// (`lobby/created`, `lobby/joined`) replace the baseline outright — including on
// reconnect, where they reset the rev baseline. Deltas apply-if-newer by `rev`, so a
// duplicate or out-of-order delta is idempotent and a stale delta buffered across a
// reconnect is dropped.
export function applyRoster(prev: LobbySnapshot | null, msg: ServerMessage): LobbySnapshot | null {
  switch (msg.type) {
    case "lobby/created":
    case "lobby/joined":
      return msg.snapshot;
    case "lobby/player-joined":
      return withDelta(prev, msg.rev, (s) => ({
        ...s,
        players: sortBySlot([...s.players, msg.player]),
      }));
    case "lobby/player-left":
      return withDelta(prev, msg.rev, (s) => ({
        ...s,
        players: s.players.filter((p) => p.id !== msg.id),
      }));
    case "lobby/presence-changed":
      return withDelta(prev, msg.rev, (s) => ({
        ...s,
        players: s.players.map((p) => (p.id === msg.id ? { ...p, presence: msg.presence } : p)),
      }));
    case "lobby/host-changed":
      return withDelta(prev, msg.rev, (s) => ({ ...s, host: msg.host }));
    default:
      return prev;
  }
}

// Apply a delta only when it advances `rev` past the current baseline, then stamp the
// snapshot with the delta's rev. A delta arriving before any snapshot is dropped.
function withDelta(
  prev: LobbySnapshot | null,
  rev: number,
  update: (s: LobbySnapshot) => LobbySnapshot,
): LobbySnapshot | null {
  if (prev === null || rev <= prev.rev) return prev;
  return { ...update(prev), rev };
}

function sortBySlot(players: LobbySnapshot["players"]): LobbySnapshot["players"] {
  return [...players].sort((a, b) => a.slot - b.slot);
}
