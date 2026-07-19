import { LobbyScreen } from "./lobby/LobbyScreen";
import { Menu } from "./lobby/Menu";
import { useLobby } from "./lobby/useLobby";

// Milestone 1 is DOM-only: the app is the menu and the lobby. The canvas game world
// arrives in Milestone 2.
export function App() {
  const { state, client } = useLobby();

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
