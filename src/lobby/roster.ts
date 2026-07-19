import type { LobbySnapshot, ServerMessage } from "./protocol";

// Fold a server message into the local roster snapshot. Full-snapshot messages
// (`lobby/created`, `lobby/joined`) replace the baseline outright; deltas apply-if-
// newer by `rev` so out-of-order or duplicate deltas are idempotent. Delta handling
// is added as the live-roster and presence tickets land.
export function applyRoster(prev: LobbySnapshot | null, msg: ServerMessage): LobbySnapshot | null {
  switch (msg.type) {
    case "lobby/created":
    case "lobby/joined":
      return msg.snapshot;
    default:
      return prev;
  }
}
