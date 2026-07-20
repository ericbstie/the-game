import { GameScreen } from "./game/GameScreen";
import { LobbyScreen } from "./lobby/LobbyScreen";
import { Menu } from "./lobby/Menu";
import { useLobby } from "./lobby/useLobby";

// Three screens off one lobby store: the menu, the lobby waiting room, and the in-match
// canvas. Which one shows is derived from the session — seated + in-game phase (or a
// live world frame) means the match; seated + lobby phase means the waiting room.
// `wsUrl` is injectable so tests can point at a harness server.
export function App({ wsUrl }: { wsUrl?: string } = {}) {
  const { state, client } = useLobby(wsUrl ? { wsUrl } : undefined);

  const seated = state.status === "lobby" || state.status === "reconnecting";
  if (seated) {
    if (state.snapshot?.phase === "in-game" || state.world) {
      return (
        <GameScreen
          state={state}
          onLeave={() => client.leave()}
          onPos={(pos) => client.sendPos(pos)}
          onAttack={(weapon, pos, dir) => client.sendAttack(weapon, pos, dir)}
          onHealth={(hp) => client.sendHealth(hp)}
        />
      );
    }
    return (
      <LobbyScreen state={state} onLeave={() => client.leave()} onStart={() => client.start()} />
    );
  }
  return (
    <Menu
      state={state}
      onHost={(name) => client.host(name)}
      onJoin={(code, name) => client.join(code, name)}
    />
  );
}
