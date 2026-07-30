import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  localStorage.clear(); // the real client persists a token; clear the shared store
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
  // The label and the code are separate elements now that the code is set as a headline number,
  // so the code is read from the block the label sits in rather than from the label itself.
  const code =
    screen.getByText(/share code/i).parentElement?.querySelector("strong")?.textContent ?? "";
  expect(code).toHaveLength(4);
});

// #129, end to end and with nothing stubbed: two real <App>s on one harness server. The host moves a
// knob, and the *other browser* shows it — through `game/settings`, the hub's authority check, the
// `lobby/settings-changed` echo and `applyRoster`, before anyone has pressed Start.
test("the squad sees the world the host picks, before Start", async () => {
  server = startServer();
  const host = render(<App wsUrl={server.url} />);
  // Both trees live in the same document, so every query is scoped to its own browser.
  const hostView = within(host.container);
  fireEvent.change(hostView.getByLabelText(/name/i), { target: { value: "Ana" } });
  fireEvent.click(hostView.getByRole("button", { name: /host a lobby/i }));
  await waitFor(() => expect(hostView.getByRole("button", { name: /start/i })).not.toBeNull());
  const code =
    hostView.getByText(/share code/i).parentElement?.querySelector("strong")?.textContent ?? "";

  const squad = render(<App wsUrl={server.url} />);
  const squadView = within(squad.container);
  fireEvent.change(squadView.getByLabelText(/name/i), { target: { value: "Ben" } });
  fireEvent.change(squadView.getByLabelText(/lobby code/i), { target: { value: code } });
  fireEvent.click(squadView.getByRole("button", { name: /^join$/i }));
  await waitFor(() => expect(squadView.getByText("Ben")).not.toBeNull());

  const capFor = (view: ReturnType<typeof within>) =>
    (view.getByRole("spinbutton", { name: /enemy cap/i }) as HTMLInputElement).value;
  expect(capFor(squadView)).toBe("500"); // the shipped world, until the host says otherwise

  fireEvent.change(hostView.getByRole("spinbutton", { name: /enemy cap/i }), {
    target: { value: "120" },
  });
  await waitFor(() => expect(capFor(squadView)).toBe("120"));
});

test("the host can Start the match and lands in the canvas game screen", async () => {
  server = startServer();
  render(<App wsUrl={server.url} />);

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("button", { name: /host a lobby/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /start/i })).not.toBeNull());

  fireEvent.click(screen.getByRole("button", { name: /start/i }));

  // Once the first game/state arrives, the roster is replaced by the arena canvas.
  await waitFor(() => expect(screen.getByLabelText(/game arena/i)).not.toBeNull());
  // The HUD came up with it. Asserted on the build bar because the controls hint that used to
  // stand in for "the match is on screen" is gone — ADR 0001 removed it.
  expect(screen.getByRole("toolbar", { name: /buildables/i })).not.toBeNull();
  expect(screen.queryByText(/WASD/i)).toBeNull();
});
