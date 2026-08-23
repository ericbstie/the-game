import { EndScreen } from "./game/EndScreen";
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
    // A finished match outranks the live world: the run is over, so show the time, not the box.
    if (state.matchEnd) {
      return (
        <EndScreen
          outcome={state.matchEnd.outcome}
          elapsedMs={state.matchEnd.elapsedMs}
          onLeave={() => client.leave()}
        />
      );
    }
    if (state.snapshot?.phase === "in-game" || state.world) {
      return (
        <GameScreen
          state={state}
          onLeave={() => client.leave()}
          onPos={(pos) => client.sendPos(pos)}
          onAttack={(pos, dir) => client.sendAttack(pos, dir)}
          onHealth={(hp) => client.sendHealth(hp)}
          onMine={(tile) => client.sendMine(tile)}
          onBuild={(kind, tile) => client.sendBuild(kind, tile)}
          onDemolish={(id) => client.sendDemolish(id)}
          onForge={() => client.sendForge()}
        />
      );
    }
    return (
      <LobbyScreen
        state={state}
        onLeave={() => client.leave()}
        onStart={() => client.start()}
        onSettings={(settings) => client.sendSettings(settings)}
        onTutorial={(tutorial) => client.sendTutorial(tutorial)}
      />
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
