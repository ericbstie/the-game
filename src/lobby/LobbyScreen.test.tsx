import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { LobbyState } from "./client";
import { LobbyScreen } from "./LobbyScreen";
import type { LobbySnapshot } from "./protocol";

afterEach(cleanup);

const snapshot: LobbySnapshot = {
  code: "AB3K",
  phase: "lobby",
  maxPlayers: 6,
  host: "p1",
  players: [
    { id: "p1", name: "Ana", slot: 1, presence: { status: "connected" } },
    { id: "p2", name: "Ben", slot: 2, presence: { status: "disconnected", graceExpiresAt: 0 } },
  ],
  rev: 3,
};

const state: LobbyState = {
  status: "lobby",
  code: "AB3K",
  self: { id: "p2", token: "t", slot: 2 },
  snapshot,
};

describe("LobbyScreen", () => {
  test("shows the shareable code and one row per seat", () => {
    render(<LobbyScreen state={state} onLeave={mock()} />);
    expect(screen.getByText("AB3K")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getAllByText(/empty/i)).toHaveLength(4);
  });

  test("marks the host and the current player", () => {
    render(<LobbyScreen state={state} onLeave={mock()} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText(/host/i)).not.toBeNull(); // Ana in slot 1
    expect(within(rows[1]).getByText(/you/i)).not.toBeNull(); // Ben (self) in slot 2
  });

  test("greys a disconnected player and shows a reconnecting hint", () => {
    render(<LobbyScreen state={state} onLeave={mock()} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[1].className).toContain("disconnected");
    expect(within(rows[1]).getByText(/reconnecting/i)).not.toBeNull();
  });

  test("shows a Reconnecting banner while the client itself is reconnecting", () => {
    render(<LobbyScreen state={{ ...state, status: "reconnecting" }} onLeave={mock()} />);
    expect(screen.getByRole("status").textContent).toMatch(/reconnecting/i);
  });
});
