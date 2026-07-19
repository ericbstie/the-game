import { useEffect, useRef, useSyncExternalStore } from "react";
import { LobbyClient, type LobbyClientOptions, type LobbyState } from "./client";

// Bind a single LobbyClient to React. `getState`/`subscribe` are stable bound methods,
// so useSyncExternalStore re-renders exactly when the lobby state changes; the client
// is disposed on unmount so no reconnect loop outlives the component.
export function useLobby(options?: LobbyClientOptions): { state: LobbyState; client: LobbyClient } {
  const clientRef = useRef<LobbyClient | null>(null);
  if (clientRef.current === null) clientRef.current = new LobbyClient(options);
  const client = clientRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  useEffect(() => () => client.dispose(), [client]);
  return { state, client };
}
