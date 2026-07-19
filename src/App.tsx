import { LobbyScreen } from "./lobby/LobbyScreen";
import { Menu } from "./lobby/Menu";
import { useLobby } from "./lobby/useLobby";

// Milestone 1 is DOM-only: the app is the menu and the lobby. The canvas game world
// arrives in Milestone 2. `wsUrl` is injectable so tests can point at a harness server;
// in the browser it defaults to the page's own origin.
export function App({ wsUrl }: { wsUrl?: string } = {}) {
  const { state, client } = useLobby(wsUrl ? { wsUrl } : undefined);

  if (state.status === "lobby" || state.status === "reconnecting") {
    return <LobbyScreen state={state} onLeave={() => client.leave()} />;
  }
  return (
    <Menu
      state={state}
      onHost={(name) => client.host(name)}
      onJoin={(code, name) => client.join(code, name)}
    />
  );
}
