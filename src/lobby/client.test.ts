import { afterEach, describe, expect, test } from "bun:test";
import { LobbyClient } from "./client";
import type { LobbyServer } from "./server";
import { startServer, waitForState } from "./testing";

const servers: LobbyServer[] = [];

afterEach(() => {
  for (const s of servers) s.stop();
  servers.length = 0;
});

function spawn(): LobbyServer {
  const server = startServer();
  servers.push(server);
  return server;
}

describe("T1: LobbyClient host flow", () => {
  test("host() connects, creates a lobby, and lands on the lobby with itself seated", async () => {
    const server = spawn();
    const client = new LobbyClient({ wsUrl: server.url });
    client.host("Ana");

    const state = await waitForState(client, (s) => s.status === "lobby");
    expect(state.code).toHaveLength(4);
    expect(state.self?.slot).toBe(1);
    expect(state.snapshot?.players).toHaveLength(1);
    expect(state.snapshot?.players[0].name).toBe("Ana");
    expect(state.snapshot?.host).toBe(state.self?.id);
  });
});
