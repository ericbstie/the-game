import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import type { LobbyServer } from "./lobby/server";
import { startServer } from "./lobby/testing";

// The one end-to-end DOM path: real <App> (useLobby + LobbyClient + real WebSocket +
// useSyncExternalStore) driven against a live harness server.
let server: LobbyServer | undefined;

afterEach(() => {
  cleanup();
  server?.stop();
  server = undefined;
});

test("clicking Host opens the WS and renders the Squad roster with a shareable code", async () => {
  server = startServer();
  render(<App wsUrl={server.url} />);

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("button", { name: /host a lobby/i }));

  // The lobby screen appears once lobby/created arrives over the socket.
  await waitFor(() => expect(screen.getByText(/share code/i)).not.toBeNull());
  expect(screen.getByText("Ana")).not.toBeNull();
  expect(screen.getByText(/host/i)).not.toBeNull(); // host badge
  const code = screen.getByText(/share code/i).querySelector("strong")?.textContent ?? "";
  expect(code).toHaveLength(4);
});
