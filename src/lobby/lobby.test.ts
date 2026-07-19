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

// Seat a joiner and return the client plus its private lobby/joined payload.
async function joinLobby(server: LobbyServer, code: string, name: string) {
  const client = await connect(server);
  client.send({ type: "lobby/join", code, name });
  const joined = expectMessage(
    await client.waitFor((m) => m.type === "lobby/joined"),
    "lobby/joined",
  );
  return { client, joined };
}

describe("T4: disconnect greys the slot; reconnect reclaims it", () => {
  test("a dropped socket greys the player for others and holds the slot", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await ben.close(); // simulate a dropped socket (no explicit leave)

    const presence = expectMessage(
      await hostClient.waitFor((m) => m.type === "lobby/presence-changed"),
      "lobby/presence-changed",
    );
    expect(presence.id).toBe(joined.you.id);
    expect(presence.presence.status).toBe("disconnected");

    // Ben's slot 2 is held during grace: a fresh joiner takes slot 3, not 2.
    const { joined: charlie } = await joinLobby(server, code, "Charlie");
    expect(charlie.you.slot).toBe(3);
  });

  test("reconnecting within grace with the token reclaims the same slot and resyncs", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await ben.close();
    await hostClient.waitFor((m) => m.type === "lobby/presence-changed");

    // A fresh socket re-presents the persisted token.
    const reconnected = await connect(server);
    reconnected.send({ type: "lobby/join", code, name: "Ben", token: joined.you.token });
    const rejoined = expectMessage(
      await reconnected.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(rejoined.reclaimed).toBe(true);
    expect(rejoined.you.id).toBe(joined.you.id); // same identity
    expect(rejoined.you.slot).toBe(2); // same slot
    expect(rejoined.snapshot.players).toHaveLength(2); // resynced roster

    const backOnline = expectMessage(
      await hostClient.waitFor(
        (m) => m.type === "lobby/presence-changed" && m.id === joined.you.id,
      ),
      "lobby/presence-changed",
    );
    expect(backOnline.presence.status).toBe("connected");
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T5: grace expiry, takeover, and empty-session teardown", () => {
  test("when grace elapses the player becomes gone and the slot is released", async () => {
    const server = spawn(40); // short grace
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await ben.close();
    const left = expectMessage(
      await hostClient.waitFor((m) => m.type === "lobby/player-left"),
      "lobby/player-left",
    );
    expect(left.id).toBe(joined.you.id);
    expect(left.reason).toBe("grace-expired");

    // Slot 2 is now free: a new joiner takes it.
    const { joined: charlie } = await joinLobby(server, code, "Charlie");
    expect(charlie.you.slot).toBe(2);
  });

  test("a stale token after the slot was released is rejected with slot-released", async () => {
    const server = spawn(40);
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await ben.close();
    await hostClient.waitFor((m) => m.type === "lobby/player-left"); // grace expired

    const stale = await connect(server);
    stale.send({ type: "lobby/join", code, name: "Ben", token: joined.you.token });
    const err = expectMessage(await stale.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("slot-released");
  });

  test("host-gone-by-grace reassigns the host like an explicit leave", async () => {
    const server = spawn(40);
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await hostClient.close(); // the host drops and never returns
    const hostChanged = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/host-changed"),
      "lobby/host-changed",
    );
    expect(hostChanged.host).toBe(joined.you.id); // Ben, the lowest occupied slot
  });

  test("an explicit leave that empties the session frees the code for reuse", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Solo");
    hostClient.send({ type: "lobby/leave" });
    await sleep(20); // let the leave settle

    const rejoin = await connect(server);
    rejoin.send({ type: "lobby/join", code, name: "Latecomer" });
    const err = expectMessage(await rejoin.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("lobby-not-found"); // session destroyed, code freed
  });

  test("grace expiry of the last player destroys the empty session", async () => {
    const server = spawn(40);
    const { code } = await host(server, "Solo");
    // Drop the only player and wait out the grace window.
    await clients[clients.length - 1].close();
    await sleep(120);

    const rejoin = await connect(server);
    rejoin.send({ type: "lobby/join", code, name: "Latecomer" });
    const err = expectMessage(await rejoin.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("lobby-not-found");
  });

  test("a second live connection with an active token takes over; the old is superseded", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    // A new socket presents Ben's still-active token.
    const takeover = await connect(server);
    takeover.send({ type: "lobby/join", code, name: "Ben", token: joined.you.token });

    const superseded = await ben.waitFor((m) => m.type === "lobby/superseded");
    expect(superseded.type).toBe("lobby/superseded");

    const rejoined = expectMessage(
      await takeover.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(rejoined.tookOver).toBe(true);
    expect(rejoined.you.slot).toBe(2);
    expect(rejoined.you.id).toBe(joined.you.id);
  });

  test("host reassignment prefers a connected player over a greyed one", async () => {
    const server = spawn(); // long default grace so Ben stays greyed during the test
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined: benJoined } = await joinLobby(server, code, "Ben");
    const { client: charlie, joined: charlieJoined } = await joinLobby(server, code, "Charlie");

    await ben.close(); // Ben (slot 2) becomes disconnected-in-grace
    await charlie.waitFor((m) => m.type === "lobby/presence-changed");

    hostClient.send({ type: "lobby/leave" }); // host leaves -> reassignment
    const hostChanged = expectMessage(
      await charlie.waitFor((m) => m.type === "lobby/host-changed"),
      "lobby/host-changed",
    );
    // Host goes to Charlie (slot 3, connected), not Ben (slot 2, greyed).
    expect(hostChanged.host).toBe(charlieJoined.you.id);
    expect(hostChanged.host).not.toBe(benJoined.you.id);
  });
});
