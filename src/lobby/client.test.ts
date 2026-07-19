import { afterEach, describe, expect, test } from "bun:test";
import { LobbyClient, type LobbyClientOptions } from "./client";
import type { LobbyServer } from "./server";
import { makeClient, startServer, type TestClient, waitForState } from "./testing";

const servers: LobbyServer[] = [];
const clientList: LobbyClient[] = [];
const rawClients: TestClient[] = [];

afterEach(async () => {
  // Dispose clients (stops reconnect loops) before stopping servers, or a stale
  // reconnect attempt to a downed server would surface in a later test.
  for (const c of clientList) c.dispose();
  clientList.length = 0;
  await Promise.all(rawClients.map((c) => c.close().catch(() => {})));
  rawClients.length = 0;
  for (const s of servers) s.stop();
  servers.length = 0;
  localStorage.clear(); // clients persist tokens; clear the shared happy-dom store
});

function spawn(graceMs?: number): LobbyServer {
  const server = startServer(graceMs === undefined ? {} : { graceMs });
  servers.push(server);
  return server;
}

function newClient(options: LobbyClientOptions): LobbyClient {
  const client = new LobbyClient(options);
  clientList.push(client);
  return client;
}

describe("T1: LobbyClient host flow", () => {
  test("host() connects, creates a lobby, and lands on the lobby with itself seated", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url });
    client.host("Ana");

    const state = await waitForState(client, (s) => s.status === "lobby");
    expect(state.code).toHaveLength(4);
    expect(state.self?.slot).toBe(1);
    expect(state.snapshot?.players).toHaveLength(1);
    expect(state.snapshot?.players[0].name).toBe("Ana");
    expect(state.snapshot?.host).toBe(state.self?.id);
  });
});

describe("T2: LobbyClient join flow", () => {
  test("join() seats a second player who sees the full roster", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const joiner = newClient({ wsUrl: server.url });
    joiner.join(hosted.code ?? "", "Ben");
    const joined = await waitForState(joiner, (s) => s.status === "lobby");
    expect(joined.self?.slot).toBe(2);
    expect(joined.snapshot?.players.map((p) => p.name)).toEqual(["Ana", "Ben"]);
  });

  test("joining an unknown code returns to the menu with an error", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url });
    client.join("ZZZZ", "Ben");
    const state = await waitForState(client, (s) => s.status === "menu" && s.error !== undefined);
    expect(state.error).toMatch(/not found/i);
  });
});

describe("T3: LobbyClient live roster", () => {
  test("a peer who joins later appears on the host's roster in real time", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const joiner = newClient({ wsUrl: server.url });
    joiner.join(hosted.code ?? "", "Ben");
    await waitForState(joiner, (s) => s.status === "lobby");

    const state = await waitForState(hostClient, (s) => (s.snapshot?.players.length ?? 0) === 2);
    expect(state.snapshot?.players.map((p) => p.name)).toEqual(["Ana", "Ben"]);
  });

  test("when a peer leaves, the host's roster drops them and reassigns the host if needed", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const joiner = newClient({ wsUrl: server.url });
    joiner.join(hosted.code ?? "", "Ben");
    const joined = await waitForState(joiner, (s) => s.status === "lobby");
    await waitForState(hostClient, (s) => (s.snapshot?.players.length ?? 0) === 2);

    // The host leaves; Ben (the only remaining player) should become host.
    hostClient.leave();
    const benState = await waitForState(joiner, (s) => s.snapshot?.host === joined.self?.id);
    expect(benState.snapshot?.players.map((p) => p.name)).toEqual(["Ben"]);
  });
});

// Reach past the store seam to sever the socket the way a network drop would.
function dropSocket(client: LobbyClient): void {
  (client as unknown as { ws?: WebSocket }).ws?.close();
}

describe("T4: LobbyClient reconnect", () => {
  test("persists the token in localStorage keyed by the lobby code", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url });
    client.host("Ana");
    const state = await waitForState(client, (s) => s.status === "lobby");
    expect(localStorage.getItem(`lobby:token:${state.code}`)).toBe(state.self?.token ?? "");
  });

  test("a dropped socket shows Reconnecting… then reclaims the same slot and token", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url, retryMs: 20 });
    client.host("Ana");
    const before = await waitForState(client, (s) => s.status === "lobby");
    const token = before.self?.token;

    dropSocket(client);
    await waitForState(client, (s) => s.status === "reconnecting");
    const after = await waitForState(client, (s) => s.status === "lobby", 3000);
    expect(after.self?.slot).toBe(1);
    expect(after.self?.token).toBe(token ?? "");
  });

  test("a peer sees a dropped player grey out and then come back", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const joiner = newClient({ wsUrl: server.url, retryMs: 20 });
    joiner.join(hosted.code ?? "", "Ben");
    const joined = await waitForState(joiner, (s) => s.status === "lobby");
    await waitForState(hostClient, (s) => (s.snapshot?.players.length ?? 0) === 2);

    dropSocket(joiner);
    const greyed = await waitForState(
      hostClient,
      (s) =>
        s.snapshot?.players.find((p) => p.id === joined.self?.id)?.presence.status ===
        "disconnected",
    );
    expect(greyed.snapshot?.players).toHaveLength(2); // held, not removed

    const recovered = await waitForState(
      hostClient,
      (s) =>
        s.snapshot?.players.find((p) => p.id === joined.self?.id)?.presence.status === "connected",
      3000,
    );
    expect(recovered.snapshot?.players).toHaveLength(2);
  });
});

describe("T5: LobbyClient slot release and takeover", () => {
  test("a reconnect after the slot was released lands in the returned-to-menu state", async () => {
    // Grace (30ms) is shorter than the joiner's retry (200ms), so the slot is
    // released before the client re-presents its token.
    const server = spawn(30);
    const hostClient = newClient({ wsUrl: server.url }); // keeps the session alive
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const joiner = newClient({ wsUrl: server.url, retryMs: 200 });
    joiner.join(hosted.code ?? "", "Ben");
    await waitForState(joiner, (s) => s.status === "lobby");

    dropSocket(joiner);
    const released = await waitForState(joiner, (s) => s.status === "released", 2000);
    expect(released.error).toMatch(/released/i);
    expect(released.snapshot).toBeUndefined(); // returned to menu
  });

  test("being taken over by another device returns to the menu", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url });
    client.host("Ana");
    const state = await waitForState(client, (s) => s.status === "lobby");

    // A second socket presents this client's still-active token -> takeover.
    const other = makeClient(server.url);
    rawClients.push(other); // tracked so teardown closes it even if an assertion throws
    await other.opened;
    other.send({
      type: "lobby/join",
      code: state.code ?? "",
      name: "Ana",
      token: state.self?.token,
    });

    const back = await waitForState(client, (s) => s.status === "menu" && s.error !== undefined);
    expect(back.error).toMatch(/another device/i);
  });

  test("reconnect gives up and returns to the menu once the retry window elapses", async () => {
    const server = spawn();
    // Window (10ms) shorter than the retry (60ms): the first retry sees the window
    // elapsed and gives up rather than looping forever against an unreachable server.
    const client = newClient({ wsUrl: server.url, retryMs: 60, reconnectWindowMs: 10 });
    client.host("Ana");
    await waitForState(client, (s) => s.status === "lobby");

    dropSocket(client);
    const gaveUp = await waitForState(
      client,
      (s) => s.status === "menu" && s.error !== undefined,
      2000,
    );
    expect(gaveUp.error).toMatch(/lost connection/i);
  });
});

// Poll a synchronous predicate: peer positions mutate the live world in place without a
// setState, so waitForState (which fires only on store notifications) can't observe them.
async function poll(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("poll timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("M2R: LobbyClient game flow", () => {
  test("start() builds the local world with the player seated, phase in-game", async () => {
    const server = spawn();
    const client = newClient({ wsUrl: server.url });
    client.host("Ana");
    await waitForState(client, (s) => s.status === "lobby");

    client.start();
    const inGame = await waitForState(client, (s) => s.world !== undefined);
    expect(inGame.world?.snapshot(Date.now()).players).toHaveLength(1);
    expect(inGame.snapshot?.phase).toBe("in-game"); // local phase flips into the match
  });

  test("a peer's relayed position moves that peer in the local world", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    // A raw peer joins and drives its own position over the wire.
    const peer = makeClient(server.url);
    rawClients.push(peer);
    await peer.opened;
    peer.send({ type: "lobby/join", code: hosted.code ?? "", name: "Ben" });
    const peerJoined = await peer.waitFor((m) => m.type === "lobby/joined");
    const peerId = (peerJoined as { you: { id: string } }).you.id;

    hostClient.start();
    await peer.waitFor((m) => m.type === "game/world-init");

    peer.send({ type: "game/pos", pos: { x: 777, y: 333 }, seq: 1 });
    await poll(() => {
      const p = hostClient
        .getState()
        .world?.snapshot(Date.now())
        .players.find((a) => a.id === peerId);
      return p?.pos.x === 777 && p?.pos.y === 333;
    });
  });

  test("a peer leaving removes them from the local world", async () => {
    const server = spawn();
    const hostClient = newClient({ wsUrl: server.url });
    hostClient.host("Ana");
    const hosted = await waitForState(hostClient, (s) => s.status === "lobby");

    const peer = makeClient(server.url);
    rawClients.push(peer);
    await peer.opened;
    peer.send({ type: "lobby/join", code: hosted.code ?? "", name: "Ben" });
    await peer.waitFor((m) => m.type === "lobby/joined");
    await waitForState(hostClient, (s) => (s.snapshot?.players.length ?? 0) === 2);

    hostClient.start();
    await waitForState(hostClient, (s) => s.world !== undefined);
    await poll(() => hostClient.getState().world?.snapshot(Date.now()).players.length === 2);

    peer.send({ type: "lobby/leave" });
    await waitForState(hostClient, (s) => (s.snapshot?.players.length ?? 0) === 1);
    const remaining = hostClient.getState().world?.snapshot(Date.now()).players ?? [];
    expect(remaining.map((p) => p.id)).toEqual([hosted.self?.id ?? ""]);
  });
});
