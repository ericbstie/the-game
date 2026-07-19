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

// Host a lobby and return the client plus its shareable code.
async function host(
  server: LobbyServer,
  name = "Host",
): Promise<{ client: TestClient; code: string }> {
  const client = await connect(server);
  client.send({ type: "lobby/create", name });
  const created = expectMessage(
    await client.waitFor((m) => m.type === "lobby/created"),
    "lobby/created",
  );
  return { client, code: created.code };
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

describe("T2: join a lobby by code", () => {
  test("join seats the next open slot and returns a full snapshot with both players", async () => {
    const server = spawn();
    const { code } = await host(server, "Ana");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "Ben" });

    const joined = expectMessage(
      await joiner.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(joined.reclaimed).toBe(false);
    expect(joined.tookOver).toBe(false);
    expect(joined.you.slot).toBe(2);
    expect(joined.snapshot.players).toHaveLength(2);
    expect(joined.snapshot.players.map((p) => p.name)).toEqual(["Ana", "Ben"]);
    expect(joined.snapshot.players.map((p) => p.slot)).toEqual([1, 2]);
  });

  test("an unknown code is rejected with lobby-not-found", async () => {
    const joiner = await connect(spawn());
    joiner.send({ type: "lobby/join", code: "ZZZZ", name: "Ben" });
    const err = expectMessage(await joiner.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("lobby-not-found");
  });

  test("a 7th join is rejected with lobby-full", async () => {
    const server = spawn();
    const { code } = await host(server, "Host");
    for (let i = 2; i <= 6; i++) {
      const c = await connect(server);
      c.send({ type: "lobby/join", code, name: `P${i}` });
      await c.waitFor((m) => m.type === "lobby/joined");
    }
    const seventh = await connect(server);
    seventh.send({ type: "lobby/join", code, name: "Late" });
    const err = expectMessage(
      await seventh.waitFor((m) => m.type === "lobby/error"),
      "lobby/error",
    );
    expect(err.code).toBe("lobby-full");
  });

  test("an empty name defaults to `Player N` where N is the slot", async () => {
    const server = spawn();
    const { code } = await host(server, "Ana");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "" });
    const joined = expectMessage(
      await joiner.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(joined.snapshot.players[1].name).toBe("Player 2");
  });

  test("an over-long name is rejected as invalid", async () => {
    const server = spawn();
    const { code } = await host(server, "Ana");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "x".repeat(17) });
    const err = expectMessage(await joiner.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("invalid");
  });

  test("duplicate names are allowed; the slot disambiguates", async () => {
    const server = spawn();
    const { code } = await host(server, "Sam");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "Sam" });
    const joined = expectMessage(
      await joiner.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(joined.snapshot.players.map((p) => p.name)).toEqual(["Sam", "Sam"]);
  });

  test("a lowercase code is normalized to the real lobby", async () => {
    const server = spawn();
    const { code } = await host(server, "Ana"); // e.g. "AB3K"
    // Present the code lowercased; server normalizes before lookup.
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code: code.toLowerCase(), name: "Ben" });
    const joined = expectMessage(
      await joiner.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(joined.code).toBe(code);
  });
});

describe("T3: live roster", () => {
  test("an existing member is notified when a new player joins", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "Ben" });

    const delta = expectMessage(
      await hostClient.waitFor((m) => m.type === "lobby/player-joined"),
      "lobby/player-joined",
    );
    expect(delta.player.name).toBe("Ben");
    expect(delta.player.slot).toBe(2);
    expect(delta.rev).toBe(1);
  });

  test("an explicit leave frees the slot and notifies the others", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const joiner = await connect(server);
    joiner.send({ type: "lobby/join", code, name: "Ben" });
    const joined = expectMessage(
      await joiner.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    joiner.send({ type: "lobby/leave" });
    const left = expectMessage(
      await hostClient.waitFor((m) => m.type === "lobby/player-left"),
      "lobby/player-left",
    );
    expect(left.id).toBe(joined.you.id);
    expect(left.slot).toBe(2);
    expect(left.reason).toBe("left");
  });

  test("when the host leaves, host passes to the lowest occupied slot", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const ben = await connect(server);
    ben.send({ type: "lobby/join", code, name: "Ben" });
    const benJoined = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );

    hostClient.send({ type: "lobby/leave" });
    const hostChanged = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/host-changed"),
      "lobby/host-changed",
    );
    expect(hostChanged.host).toBe(benJoined.you.id); // Ben is now the lowest occupied slot
  });
});
