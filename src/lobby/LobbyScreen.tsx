import type { LobbyState } from "./client";
import type { PublicPlayer } from "./protocol";

interface LobbyScreenProps {
  state: LobbyState;
  onLeave: () => void;
}

// The lobby screen: shareable code plus the Squad roster. Every seat 1..maxPlayers is
// shown; occupied seats mark the host and you, and grey out during a disconnect grace.
export function LobbyScreen({ state, onLeave }: LobbyScreenProps) {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const seats = Array.from({ length: snapshot.maxPlayers }, (_, i) => i + 1);
  const bySlot = new Map(snapshot.players.map((p) => [p.slot, p]));

  return (
    <main className="lobby">
      <header className="lobby-header">
        <h1>Squad</h1>
        <p className="code">
          Share code <strong>{state.code}</strong>
        </p>
      </header>
      {state.status === "reconnecting" && (
        <p className="banner" role="status">
          Reconnecting…
        </p>
      )}
      <ul className="roster">
        {seats.map((slot) => {
          const player = bySlot.get(slot);
          return (
            <li key={slot} className={seatClass(player)}>
              <span className="slot">{slot}</span>
              {player ? (
                <Seat
                  player={player}
                  isYou={player.id === state.self?.id}
                  isHost={player.id === snapshot.host}
                />
              ) : (
                <span className="empty">Empty</span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onLeave}>
        Leave
      </button>
    </main>
  );
}

function Seat({
  player,
  isYou,
  isHost,
}: {
  player: PublicPlayer;
  isYou: boolean;
  isHost: boolean;
}) {
  const disconnected = player.presence.status === "disconnected";
  return (
    <span className="seat">
      <span className="name">{player.name}</span>
      {isHost && <span className="badge host-badge">Host</span>}
      {isYou && <span className="badge you-badge">You</span>}
      {disconnected && <span className="presence">reconnecting…</span>}
    </span>
  );
}

function seatClass(player: PublicPlayer | undefined): string {
  if (!player) return "seat-row vacant";
  return player.presence.status === "disconnected" ? "seat-row disconnected" : "seat-row";
}
