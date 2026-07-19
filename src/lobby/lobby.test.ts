import { afterEach, describe, expect, test } from "bun:test";
import type { LobbyServer } from "./server";
import { expectMessage, makeClient, startServer, type TestClient } from "./testing";

const servers: LobbyServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  clients.length = 0;
  for (const s of servers) s.stop();
  servers.length = 0;
});

function spawn(graceMs?: number): LobbyServer {
  const server = startServer(graceMs === undefined ? {} : { graceMs });
  servers.push(server);
  return server;
}

async function connect(server: LobbyServer): Promise<TestClient> {
  const client = makeClient(server.url);
  clients.push(client);
  await client.opened;
  return client;
}

describe("T1: host a lobby", () => {
  test("host receives lobby/created seating them as host in slot 1", async () => {
    const host = await connect(spawn());
    host.send({ type: "lobby/create", name: "Ana" });

    const created = expectMessage(
      await host.waitFor((m) => m.type === "lobby/created"),
      "lobby/created",
    );
    expect(created.code).toHaveLength(4);
    expect(created.you.id).toBeTruthy();
    expect(created.you.token).toBeTruthy();
    expect(created.you.id).not.toBe(created.you.token);
    expect(created.you.slot).toBe(1);
    expect(created.snapshot.host).toBe(created.you.id);
    expect(created.snapshot.rev).toBe(0);
    expect(created.snapshot.players).toHaveLength(1);
    expect(created.snapshot.players[0]).toMatchObject({
      id: created.you.id,
      name: "Ana",
      slot: 1,
      presence: { status: "connected" },
    });
  });

  test("the private token never appears in the public snapshot", async () => {
    const host = await connect(spawn());
    host.send({ type: "lobby/create", name: "Ana" });
    const created = expectMessage(
      await host.waitFor((m) => m.type === "lobby/created"),
      "lobby/created",
    );
    expect(JSON.stringify(created.snapshot)).not.toContain(created.you.token);
  });

  test("an empty name defaults to `Player N`", async () => {
    const host = await connect(spawn());
    host.send({ type: "lobby/create", name: "   " });
    const created = expectMessage(
      await host.waitFor((m) => m.type === "lobby/created"),
      "lobby/created",
    );
    expect(created.snapshot.players[0].name).toBe("Player 1");
  });
});
