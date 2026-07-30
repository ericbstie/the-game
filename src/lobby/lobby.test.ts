import { afterEach, describe, expect, test } from "bun:test";
import {
  BUILDABLES,
  BULLET_COST,
  FORGE_MS,
  footprintCenter,
  generateOre,
  HAND_MINE_RATE,
  MINE_CADENCE_MS,
  TURRET_CADENCE_MS,
  TURRET_DAMAGE,
  TURRET_RANGE,
  tileCenter,
  tileOf,
} from "../game/build";
import {
  ATTACK_POS_TOLERANCE,
  NEST_COUNT,
  type Nest,
  nestLayout,
  RANGED_CADENCE_MS,
} from "../game/enemies";
import { ARENA } from "../game/world";
import { type LobbyConfig, LobbyHub, livePlayers, type Transport } from "./lobby";
import type { EnemySpawn, Exit, ServerMessage, Tile, Vec2 } from "./protocol";
import type { LobbyServer } from "./server";
import {
  expectMessage,
  ManualScheduler,
  makeClient,
  startServer,
  type TestClient,
} from "./testing";

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

// Host a lobby and return the client plus its shareable code. The token comes back too, so a
// test can drop this socket and reconnect as the same player.
async function host(
  server: LobbyServer,
  name = "Host",
): Promise<{ client: TestClient; code: string; id: string; token: string }> {
  const client = await connect(server);
  client.send({ type: "lobby/create", name });
  const created = expectMessage(
    await client.waitFor((m) => m.type === "lobby/created"),
    "lobby/created",
  );
  return { client, code: created.code, id: created.you.id, token: created.you.token };
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

  // A dropped host must hand the badge on immediately, not at grace expiry: Start is gated on
  // `session.host`, so a host held by an absent player is a lobby nobody can start (#22).
  test("a dropped host hands the badge to the lowest connected slot at once", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben, joined: benJoined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await hostClient.close(); // the host closes the tab — no explicit leave

    const hostChanged = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/host-changed"),
      "lobby/host-changed",
    );
    expect(hostChanged.host).toBe(benJoined.you.id);
  });

  test("and the new host can start the match without waiting out the grace window", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await hostClient.close();
    await ben.waitFor((m) => m.type === "lobby/host-changed");

    ben.send({ type: "game/start" });
    const init = await ben.waitFor((m) => m.type === "game/world-init");
    expect(init.type).toBe("game/world-init"); // the squad is not stuck for 45s
  });

  test("the host badge stays put if the dropped player was not the host", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await ben.close();
    await hostClient.waitFor((m) => m.type === "lobby/presence-changed");
    expect(hostClient.peek((m) => m.type === "lobby/host-changed")).toBeNull(); // Ana keeps it
  });

  test("a reconnecting host does not take the badge back", async () => {
    const server = spawn();
    const { client: hostClient, code, token } = await host(server, "Ana");
    const { client: ben, joined: benJoined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await hostClient.close();
    await ben.waitFor((m) => m.type === "lobby/host-changed");

    const back = await connect(server);
    back.send({ type: "lobby/join", code, name: "Ana", token });
    const rejoined = expectMessage(
      await back.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(rejoined.reclaimed).toBe(true);
    expect(rejoined.snapshot.host).toBe(benJoined.you.id); // Ben keeps it; no ping-pong
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// How far behind an enemy a shot is fired from, when a test wants that shot to connect. It has to
// clear the whole-unit rounding the delta applies to positions (#84) — half a unit either way, which
// is otherwise enough to put the ray's origin the wrong side of its target — and stay well inside the
// 300 u of spawn jitter, so the shooter's own nest cannot end up between the two.
const BEHIND = 4;

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

  // The badge moves the instant the socket drops (T4); this covers the rest of the journey —
  // the seat is still released when the grace window then expires, and the badge does not
  // travel a second time on the way out.
  test("a host who drops and never returns hands over once, then loses the seat", async () => {
    const server = spawn(40);
    const { client: hostClient, code, id: anaId } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    await hostClient.close(); // the host drops and never returns
    const hostChanged = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/host-changed"),
      "lobby/host-changed",
    );
    expect(hostChanged.host).toBe(joined.you.id); // Ben, the lowest occupied slot

    const left = expectMessage(
      await ben.waitFor((m) => m.type === "lobby/player-left"),
      "lobby/player-left",
    );
    expect(left.id).toBe(anaId);
    expect(left.reason).toBe("grace-expired");
    expect(ben.peek((m) => m.type === "lobby/host-changed" && m.host !== joined.you.id)).toBeNull();
  });

  test("an explicit leave that empties the session frees the code for reuse", async () => {
    const server = spawn();
    const { client, code } = await host(server, "Solo");
    // Leave then rejoin on the SAME socket: same-socket message ordering guarantees the
    // leave (which empties + destroys the session) is processed first — no sleep/race.
    client.send({ type: "lobby/leave" });
    client.send({ type: "lobby/join", code, name: "Latecomer" });
    const err = expectMessage(await client.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("lobby-not-found"); // session destroyed, code freed
  });

  test("grace expiry of the last player destroys the empty session", async () => {
    const server = spawn(25); // short grace; the wait below clears it by a wide margin
    const { client, code } = await host(server, "Solo");
    await client.close(); // drop the only player; its grace will expire
    await sleep(300);

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

  test("a second identity command on an already-bound socket is rejected as invalid", async () => {
    const server = spawn();
    const { client } = await host(server, "Ana"); // socket now owns the host player
    // The same socket attempts to join another lobby — must be rejected, not rebound.
    client.send({ type: "lobby/join", code: "ZZZZ", name: "Ghost" });
    const err = expectMessage(await client.waitFor((m) => m.type === "lobby/error"), "lobby/error");
    expect(err.code).toBe("invalid");
  });
});

describe("M2R: host starts the match and world-init streams", () => {
  test("host start sends game/world-init to every player, spawns slot-ordered", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });

    const hostInit = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    );
    const benInit = expectMessage(
      await ben.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    );
    expect(hostInit.init.spawns).toHaveLength(2);
    expect(benInit.init.spawns.map((s) => s.slot)).toEqual([1, 2]);
    expect(hostInit.init.exit.width).toBeGreaterThan(0);
  });

  test("a non-host game/start is ignored; the host can still start", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    ben.send({ type: "game/start" }); // Ben is not the host
    await expect(ben.waitFor((m) => m.type === "game/world-init", 150)).rejects.toThrow();

    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");
  });

  test("no world frames stream on a timer after start (the per-tick sim loop is gone)", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");

    // Nothing is broadcast unprompted: no peer-pos, no second world-init on a tick.
    await expect(
      ben.waitFor((m) => m.type === "game/peer-pos" || m.type === "game/world-init", 150),
    ).rejects.toThrow();
  });
});

describe("M2R: the server relays positions", () => {
  test("a client's game/pos is relayed to the other players as game/peer-pos", async () => {
    const server = spawn();
    const { client: hostClient, code, id: hostId } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");

    hostClient.send({ type: "game/pos", pos: { x: 123, y: 456 }, seq: 1 });
    const relayed = expectMessage(
      await ben.waitFor((m) => m.type === "game/peer-pos"),
      "game/peer-pos",
    );
    expect(relayed.id).toBe(hostId);
    expect(relayed.pos).toEqual({ x: 123, y: 456 });
    expect(relayed.seq).toBe(1);
  });

  test("the sender does not receive its own position back", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    await joinLobby(server, code, "Ben"); // a peer to relay to; the sender is still excluded
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await hostClient.waitFor((m) => m.type === "game/world-init");

    hostClient.send({ type: "game/pos", pos: { x: 1, y: 2 }, seq: 1 });
    await expect(hostClient.waitFor((m) => m.type === "game/peer-pos", 150)).rejects.toThrow();
  });

  test("a stale or duplicate seq is dropped, not relayed", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");

    hostClient.send({ type: "game/pos", pos: { x: 10, y: 0 }, seq: 5 });
    await ben.waitFor((m) => m.type === "game/peer-pos" && m.seq === 5);

    hostClient.send({ type: "game/pos", pos: { x: 99, y: 0 }, seq: 3 }); // stale
    hostClient.send({ type: "game/pos", pos: { x: 20, y: 0 }, seq: 6 });
    await ben.waitFor((m) => m.type === "game/peer-pos" && m.seq === 6);

    // The stale seq-3 frame was never relayed.
    await expect(
      ben.waitFor((m) => m.type === "game/peer-pos" && m.seq === 3, 150),
    ).rejects.toThrow();
  });

  test("game/pos before the match starts is ignored", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/pos", pos: { x: 1, y: 2 }, seq: 1 }); // still in lobby
    await expect(ben.waitFor((m) => m.type === "game/peer-pos", 150)).rejects.toThrow();
  });
});

describe("M2R: reconnect rebuilds the world", () => {
  test("reconnect within grace is handed world-init and a peer-pos burst of last-known positions", async () => {
    const server = spawn(); // default (long) grace
    const { client: hostClient, code, id: hostId } = await host(server, "Ana");
    const { client: ben, joined } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");

    // The host moves, so the server retains a last-known position to replay on reconnect.
    hostClient.send({ type: "game/pos", pos: { x: 321, y: 210 }, seq: 1 });
    await ben.waitFor((m) => m.type === "game/peer-pos" && m.seq === 1);

    await ben.close(); // drop mid-match (grace, not an explicit leave)
    await hostClient.waitFor((m) => m.type === "lobby/presence-changed");

    const reconnected = await connect(server);
    reconnected.send({ type: "lobby/join", code, name: "Ben", token: joined.you.token });
    const rejoined = expectMessage(
      await reconnected.waitFor((m) => m.type === "lobby/joined"),
      "lobby/joined",
    );
    expect(rejoined.snapshot.phase).toBe("in-game"); // lands back in the match, not the lobby

    const init = expectMessage(
      await reconnected.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    );
    expect(init.init.spawns.map((s) => s.id).sort()).toEqual([hostId, joined.you.id].sort());

    const burst = expectMessage(
      await reconnected.waitFor((m) => m.type === "game/peer-pos" && m.id === hostId),
      "game/peer-pos",
    );
    expect(burst.pos).toEqual({ x: 321, y: 210 }); // host's last-known position, replayed
  });
});

describe("M3: player health relay and aggro-gating", () => {
  test("game/health is relayed to peers as game/peer-health; a stale seq is dropped", async () => {
    const server = spawn();
    const { client: hostClient, code, id: hostId } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");
    hostClient.send({ type: "game/start" });
    await ben.waitFor((m) => m.type === "game/world-init");

    hostClient.send({ type: "game/health", hp: 42, seq: 1 });
    const relayed = expectMessage(
      await ben.waitFor((m) => m.type === "game/peer-health"),
      "game/peer-health",
    );
    expect(relayed.id).toBe(hostId);
    expect(relayed.hp).toBe(42);

    hostClient.send({ type: "game/health", hp: 99, seq: 1 }); // stale (equal seq)
    hostClient.send({ type: "game/health", hp: 7, seq: 2 });
    await ben.waitFor((m) => m.type === "game/peer-health" && m.hp === 7);
    await expect(
      ben.waitFor((m) => m.type === "game/peer-health" && m.hp === 99, 150),
    ).rejects.toThrow();
  });

  test("livePlayers drops the dead from aggro; unknown/alive HP stays in", () => {
    const positions = new Map([
      ["a", { pos: { x: 1, y: 1 }, seq: 1 }],
      ["b", { pos: { x: 2, y: 2 }, seq: 1 }],
      ["c", { pos: { x: 3, y: 3 }, seq: 1 }],
    ]);
    const health = new Map([
      ["b", { hp: 0, seq: 1 }], // dead → excluded
      ["c", { hp: 50, seq: 1 }], // alive → included
      // "a" never reported → defaults to alive → included
    ]);
    expect(
      livePlayers(positions, health, new Set(["a", "b", "c"]))
        .map((p) => p.id)
        .sort(),
    ).toEqual(["a", "c"]);
  });

  // A player in the disconnect grace window is alive and still has a position — peers hold it
  // as a stand-in and the reconnect burst replays it — but there is no body in the arena for
  // an enemy to chase (#75).
  test("livePlayers drops the disconnected from aggro even though they are alive", () => {
    const positions = new Map([
      ["here", { pos: { x: 1, y: 1 }, seq: 1 }],
      ["gone", { pos: { x: 2, y: 2 }, seq: 1 }],
    ]);
    const health = new Map([
      ["here", { hp: 100, seq: 1 }],
      ["gone", { hp: 100, seq: 1 }], // full health, simply absent
    ]);
    expect(livePlayers(positions, health, new Set(["here"])).map((p) => p.id)).toEqual(["here"]);
    expect(positions.has("gone")).toBe(true); // and the position is still held for the peers
  });
});

describe("M3: reconnect rebuilds live combat state", () => {
  test("a reconnecter gets the live enemy/nest keyframe and their own HP restored", async () => {
    const server = startServer({ tickMs: 10, firstWaveMs: 5 }); // spawn a wave almost at once
    servers.push(server);
    const host = await connect(server);
    host.send({ type: "lobby/create", name: "Ana" });
    const created = expectMessage(
      await host.waitFor((m) => m.type === "lobby/created"),
      "lobby/created",
    );
    host.send({ type: "game/start" });
    await host.waitFor((m) => m.type === "game/world-init");
    await host.waitFor((m) => m.type === "game/map-delta" && (m.spawns?.length ?? 0) > 0); // wave fired
    host.send({ type: "game/health", hp: 40, seq: 1 });
    await host.close(); // drop mid-match; the slot is held by grace

    const back = await connect(server);
    back.send({ type: "lobby/join", code: created.code, name: "Ana", token: created.you.token });
    await back.waitFor((m) => m.type === "lobby/joined");

    const keyframe = expectMessage(
      await back.waitFor((m) => m.type === "game/enemy-init"),
      "game/enemy-init",
    );
    expect(keyframe.enemies.length).toBeGreaterThan(0); // live enemies, not the (empty) initial set
    expect(keyframe.nests).toHaveLength(NEST_COUNT);

    const ownHp = expectMessage(
      await back.waitFor((m) => m.type === "game/peer-health" && m.hp === 40),
      "game/peer-health",
    );
    expect(ownHp.id).toBe(created.you.id); // their own last HP, restored
  });
});

describe("M3: the enemy sim streams over the wire", () => {
  test("a started match streams game/map-delta to every player with a monotonic tick", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    await hostClient.waitFor((m) => m.type === "game/world-init");

    const hostDelta = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/map-delta"),
      "game/map-delta",
    );
    const benDelta = expectMessage(
      await ben.waitFor((m) => m.type === "game/map-delta"),
      "game/map-delta",
    );
    expect(hostDelta.tick).toBe(1); // first tick; enemies arrive only when the first wave fires
    expect(Array.isArray(hostDelta.moves)).toBe(true);
    expect(benDelta.tick).toBeGreaterThan(0); // peers receive the same stream
  });
});

// The tick's arm/cancel lifecycle, driven directly through a capture transport so timer
// behaviour is asserted deterministically (the WS harness can't observe a cancelled tick).
// Time here is virtual: the hub takes a `ManualScheduler`, so "three periods elapsed" means
// exactly three ticks however contended the CPU is. Sleeping on a real interval instead is
// what made this block red under load (#86).
describe("M3: enemy sim tick lifecycle", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }

  const deltas = (t: Capture) => t.sent.filter((m) => m.msg.type === "game/map-delta");

  function startedSolo(tickMs: number): { t: Capture; hub: LobbyHub; clock: ManualScheduler } {
    const t = new Capture();
    const clock = new ManualScheduler();
    const hub = new LobbyHub(t, { tickMs, scheduler: clock });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Solo" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    return { t, hub, clock };
  }

  test("the tick arms on game/start and streams a monotonic-tick delta each period", () => {
    const { t, hub, clock } = startedSolo(10);
    clock.advance(30); // exactly three periods
    hub.dispose();
    const ticks = deltas(t).map(
      (d) => (d.msg as Extract<ServerMessage, { type: "game/map-delta" }>).tick,
    );
    expect(ticks).toEqual([1, 2, 3]); // one delta per period, numbered from one
  });

  test("dispose() clears the tick — nothing streams after", () => {
    const { t, hub, clock } = startedSolo(10);
    clock.advance(20);
    hub.dispose();
    const n = deltas(t).length;
    expect(clock.armed).toBe(0); // the job is gone, not merely quiet
    clock.advance(1_000); // far longer than any sleep could afford to wait
    expect(deltas(t).length).toBe(n);
  });

  test("emptying the session clears the tick — nothing streams after everyone leaves", () => {
    const { t, hub, clock } = startedSolo(10);
    clock.advance(20);
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/leave" })); // last player out → session destroyed
    const n = deltas(t).length;
    expect(clock.armed).toBe(0);
    clock.advance(1_000);
    expect(deltas(t).length).toBe(n);
  });

  test("a wave spawns grunts and a validated melee on one streams its hit", () => {
    const t = new Capture();
    const clock = new ManualScheduler();
    // Fire the first wave almost at once, then step past it.
    const hub = new LobbyHub(t, { tickMs: 10, firstWaveMs: 5, scheduler: clock, startingAmmo: 9 });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Solo" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    clock.advance(30);

    // Grab a grunt the first wave spawned, straight off the stream.
    const target = deltas(t)
      .flatMap((d) => (d.msg as Extract<ServerMessage, { type: "game/map-delta" }>).spawns ?? [])
      .at(0);
    expect(target?.kind).toBe("grunt");
    if (!target) throw new Error("no spawn");

    // Where it has walked to, off the stream: an un-aggroed enemy wanders on a heading of its own
    // (#125), so the point in the spawn announcement is already stale.
    let at = target.pos;
    for (const d of deltas(t)) {
      const msg = d.msg as Extract<ServerMessage, { type: "game/map-delta" }>;
      for (const [id, x, y] of msg.moves) if (id === target.id) at = { x, y };
    }
    // Stand just behind it on the line to centre and swing along that line. `BEHIND` clears the whole-
    // unit rounding the stream applies (#84) — an origin *on* the enemy leaves half a unit of rounding
    // to decide whether it counts as in front of the ray or behind it — and is small enough that the
    // grunt's own nest, up to 300 u of jitter away, cannot slip in between and take the shot.
    const dx = ARENA.width / 2 - at.x;
    const dy = ARENA.height / 2 - at.y;
    const len = Math.hypot(dx, dy);
    const dir = { x: dx / len, y: dy / len };
    const from = { x: at.x - dir.x * BEHIND, y: at.y - dir.y * BEHIND };
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: from, seq: 1 }));
    hub.handleMessage(
      "s1",
      JSON.stringify({ type: "game/attack", weapon: "melee", pos: from, dir, seq: 1 }),
    );
    clock.advance(30);
    hub.dispose();

    const struck = deltas(t)
      .map((d) => d.msg as Extract<ServerMessage, { type: "game/map-delta" }>)
      .some(
        (d) =>
          (d.hits ?? []).some((h) => h.id === target.id) || (d.deaths ?? []).includes(target.id),
      );
    expect(struck).toBe(true);
  });
});

// #75: the slot is held for the whole grace window so a reconnect can reclaim it, and the
// player's last position stays in `session.positions` because peers hold it as a stand-in.
// The enemy sim must not read that frozen point as a body to chase.
describe("#75: a disconnected player stops pulling aggro at once", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }

  const CENTRE = { x: ARENA.width / 2, y: ARENA.height / 2 };
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

  // The first captured message of a type, narrowed — with a real error if it never arrived.
  function firstOf<T extends ServerMessage["type"]>(
    t: Capture,
    type: T,
  ): Extract<ServerMessage, { type: T }> {
    const found = t.sent.find((m) => m.msg.type === type)?.msg;
    if (!found) throw new Error(`no ${type} was sent`);
    return expectMessage(found, type);
  }

  // Two players in a started match, with the first wave already on the floor.
  function matchWithWave() {
    const t = new Capture();
    const clock = new ManualScheduler();
    const hub = new LobbyHub(t, { tickMs: 50, firstWaveMs: 1, scheduler: clock });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Ana" }));
    const { code } = firstOf(t, "lobby/created");
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/join", code, name: "Ben" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    clock.advance(50); // one tick: the wave fires
    return { t, hub, clock, code };
  }

  // A grunt of the opening wave, straight off the stream. Any of them will do: since #125 there is
  // no radius at which an un-aggroed enemy stops, so every spawn moves.
  function firstSpawn(t: Capture): EnemySpawn {
    const spawned = t.sent
      .flatMap(({ msg }) => (msg.type === "game/map-delta" ? (msg.spawns ?? []) : []))
      .at(0);
    if (!spawned) throw new Error("the first wave spawned nothing");
    return spawned;
  }

  const enemyPos = (t: Capture, id: string): Vec2 | undefined => {
    let at: Vec2 | undefined;
    for (const { msg } of t.sent) {
      if (msg.type !== "game/map-delta") continue;
      for (const s of msg.spawns ?? []) if (s.id === id) at = s.pos;
      for (const [mid, x, y] of msg.moves) if (mid === id) at = { x, y };
    }
    return at;
  };

  test("an enemy chasing a player that drops turns away from the frozen point", () => {
    const { t, hub, clock } = matchWithWave();
    const spawned = firstSpawn(t);

    // Ben stands 300 u *outward* of the grunt and Ana 900 u *inward* of it. Both are inside
    // AGGRO_RADIUS, and Ben is the nearer, so the grunt locks on to Ben — and when his socket drops
    // the only body left for it to notice is Ana, in the opposite direction. That is what makes
    // "it turned away" a certainty rather than a heading it might have drawn (#125).
    const outward = {
      x: (spawned.pos.x - CENTRE.x) / dist(spawned.pos, CENTRE),
      y: (spawned.pos.y - CENTRE.y) / dist(spawned.pos, CENTRE),
    };
    const benAt = { x: spawned.pos.x + outward.x * 300, y: spawned.pos.y + outward.y * 300 };
    const anaAt = { x: spawned.pos.x - outward.x * 900, y: spawned.pos.y - outward.y * 900 };
    hub.handleMessage("s2", JSON.stringify({ type: "game/pos", pos: benAt, seq: 1 }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: anaAt, seq: 1 }));

    clock.advance(150);
    const chasing = enemyPos(t, spawned.id);
    if (!chasing) throw new Error("the grunt never moved");
    expect(dist(chasing, benAt)).toBeLessThan(dist(spawned.pos, benAt)); // closing on Ben

    hub.handleClose("s2"); // Ben's socket drops; his slot and position are held for grace
    clock.advance(500);
    const after = enemyPos(t, spawned.id);
    if (!after) throw new Error("the grunt stopped reporting");
    expect(dist(after, benAt)).toBeGreaterThan(dist(chasing, benAt)); // turned away, not parked

    hub.dispose();
  });

  test("and it resumes the chase when they reconnect inside the window", () => {
    const { t, hub, clock, code } = matchWithWave();
    const spawned = firstSpawn(t);
    const joined = firstOf(t, "lobby/joined");
    const benAt = { x: spawned.pos.x, y: spawned.pos.y };
    hub.handleMessage("s2", JSON.stringify({ type: "game/pos", pos: benAt, seq: 1 }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: CENTRE, seq: 1 }));
    clock.advance(100);

    hub.handleClose("s2");
    clock.advance(300);
    const drifted = enemyPos(t, spawned.id);
    if (!drifted) throw new Error("the grunt stopped reporting");

    // Same token, fresh socket, inside the grace window.
    hub.handleMessage(
      "s3",
      JSON.stringify({
        type: "lobby/join",
        code,
        name: "Ben",
        token: joined.you.token,
      }),
    );
    hub.handleMessage("s3", JSON.stringify({ type: "game/pos", pos: benAt, seq: 2 }));
    clock.advance(300);
    const back = enemyPos(t, spawned.id);
    if (!back) throw new Error("the grunt stopped reporting");
    expect(dist(back, benAt)).toBeLessThan(dist(drifted, benAt)); // chasing him again

    hub.dispose();
  });
});

describe("M4-T1: hand-mining fills the squad's shared Metal bank", () => {
  // The tile a player standing at `pos` can legitimately mine: the nearest metal ore the
  // generated grid actually holds, so the test exercises admission rather than dodging it.
  function nearestMetalTile(oreSeed: number, to: Vec2): Tile {
    const ore = generateOre(ARENA, oreSeed);
    let best: Tile | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [key, kind] of ore) {
      if (kind !== "metal") continue;
      const tile = { tx: Math.floor(key / 65_536), ty: key % 65_536 };
      const c = tileCenter(tile);
      const d = Math.hypot(c.x - to.x, c.y - to.y);
      if (d < bestDist) {
        bestDist = d;
        best = tile;
      }
    }
    if (!best) throw new Error("the generated grid holds no metal ore");
    return best;
  }

  // Hold right-click on `tile` long enough to accrue whole Metal, since the bank only rides a
  // delta when its whole-number readout actually moves. The count is derived from the rate rather
  // than fixed, so a retune of `HAND_MINE_RATE` cannot leave this quietly banking fractions.
  const MINE_GAP_MS = MINE_CADENCE_MS + 20; // clear of the server's floor, under its accrual cap
  const REPORTS_FOR_ONE_METAL = Math.ceil(1_000 / (MINE_GAP_MS * HAND_MINE_RATE)) + 1;
  async function holdMine(
    client: TestClient,
    tile: Tile,
    reports = REPORTS_FOR_ONE_METAL,
  ): Promise<void> {
    client.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 });
    for (let seq = 1; seq <= reports; seq++) {
      client.send({ type: "game/mine", tile, seq });
      await new Promise((r) => setTimeout(r, MINE_GAP_MS));
    }
  }

  test("one player mining raises the Metal readout on every client", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");

    hostClient.send({ type: "game/start" });
    const init = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;

    // Stand on the ore first: admission measures reach from the last relayed position.
    const tile = nearestMetalTile(init.oreSeed, { x: ARENA.width / 2, y: ARENA.height / 2 });
    await holdMine(hostClient, tile);

    const banked = (m: ServerMessage) => m.type === "game/map-delta" && (m.bank?.metal ?? 0) > 0;
    const onHost = expectMessage(await hostClient.waitFor(banked), "game/map-delta");
    const onBen = expectMessage(await ben.waitFor(banked), "game/map-delta");
    expect(onHost.bank?.metal).toBeGreaterThan(0);
    expect(onBen.bank?.metal).toBe(onHost.bank?.metal); // one shared bank, not a per-player purse
  });

  test("mining bare ground banks nothing", async () => {
    const server = spawn();
    const { client: hostClient } = await host(server, "Ana");
    hostClient.send({ type: "game/start" });
    await hostClient.waitFor((m) => m.type === "game/world-init");

    const bare = { tx: 0, ty: 0 }; // the arena corner: outside every patch
    hostClient.send({ type: "game/pos", pos: tileCenter(bare), seq: 1 });
    for (let seq = 1; seq <= 4; seq++) hostClient.send({ type: "game/mine", tile: bare, seq });

    // Four ticks with no bank field is the assertion — a credited mine would ride one of them.
    const seen: ServerMessage[] = [];
    for (let i = 0; i < 4; i++)
      seen.push(await hostClient.waitFor((m) => m.type === "game/map-delta"));
    expect(seen.every((m) => m.type === "game/map-delta" && m.bank === undefined)).toBe(true);
  });

  test("a reconnecter is handed the live bank in the economy keyframe", async () => {
    const server = spawn();
    const { client: hostClient, code } = await host(server, "Ana");
    const joinedFirst = (await joinLobby(server, code, "Ben")).joined;
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");
    hostClient.send({ type: "game/start" });
    const init = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;

    const tile = nearestMetalTile(init.oreSeed, { x: ARENA.width / 2, y: ARENA.height / 2 });
    await holdMine(hostClient, tile);
    await hostClient.waitFor((m) => m.type === "game/map-delta" && (m.bank?.metal ?? 0) > 0);

    const back = await connect(server);
    back.send({ type: "lobby/join", code, name: "Ben", token: joinedFirst.you.token });
    const keyframe = expectMessage(
      await back.waitFor((m) => m.type === "game/build-init"),
      "game/build-init",
    );
    expect(keyframe.bank.metal).toBeGreaterThan(0);
  });
});

describe("M4-T2: placing a miner", () => {
  const MINER_COST = (BUILDABLES.miner as { cost: number }).cost;

  // A funded match: hand-mining the 50 metal a miner costs takes 6+ seconds by design, which is
  // the economy working, not something each test should re-prove.
  function funded(): LobbyServer {
    const server = startServer({ startingMetal: MINER_COST });
    servers.push(server);
    return server;
  }

  // The metal-ore tile nearest arena center, and the position a player must stand at to reach it.
  function nearestMetal(oreSeed: number): Tile {
    const ore = generateOre(ARENA, oreSeed);
    let best: Tile | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [key, kind] of ore) {
      if (kind !== "metal") continue;
      const t = { tx: Math.floor(key / 65_536), ty: key % 65_536 };
      const c = tileCenter(t);
      const d = Math.hypot(c.x - ARENA.width / 2, c.y - ARENA.height / 2);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) throw new Error("the generated grid holds no metal ore");
    return best;
  }

  async function startedMatch(server: LobbyServer, withPeer: boolean) {
    const { client: hostClient, code } = await host(server, "Ana");
    const peer = withPeer ? await joinLobby(server, code, "Ben") : null;
    if (peer) await hostClient.waitFor((m) => m.type === "lobby/player-joined");
    hostClient.send({ type: "game/start" });
    const init = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;
    const tile = nearestMetal(init.oreSeed);
    hostClient.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 }); // in reach of the tile
    return { hostClient, peer, code, tile };
  }

  test("a placed miner reaches every client and then raises the bank on its own", async () => {
    const { hostClient, peer, tile } = await startedMatch(funded(), true);
    hostClient.send({ type: "game/build", kind: "miner", tile, seq: 1 });

    const built = (m: ServerMessage) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0;
    const onHost = expectMessage(await hostClient.waitFor(built), "game/map-delta");
    const onPeer = expectMessage(
      await (peer as { client: TestClient }).client.waitFor(built),
      "game/map-delta",
    );
    expect(onHost.builds?.[0]).toMatchObject({ kind: "miner", tile, hp: 200 });
    expect(onPeer.builds?.[0]?.id).toBe(onHost.builds?.[0]?.id as string); // one shared structure

    // The bank was spent down to 0 on placement; with nobody holding right-click, only the miner
    // can bring it back up.
    const climbed = await hostClient.waitFor(
      (m) => m.type === "game/map-delta" && (m.bank?.metal ?? 0) > 0,
      3_000,
    );
    expect(expectMessage(climbed, "game/map-delta").bank?.metal).toBeGreaterThan(0);
  });

  test("placing debits the bank, so a second miner is unaffordable", async () => {
    const { hostClient, tile } = await startedMatch(funded(), false);
    hostClient.send({ type: "game/build", kind: "miner", tile, seq: 1 });
    await hostClient.waitFor((m) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0);

    const second = { tx: tile.tx + 2, ty: tile.ty };
    hostClient.send({ type: "game/build", kind: "miner", tile: second, seq: 2 });
    const seen: ServerMessage[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(await hostClient.waitFor((m) => m.type === "game/map-delta"));
    }
    expect(seen.every((m) => m.type === "game/map-delta" && m.builds === undefined)).toBe(true);
  });

  test("an unaffordable placement is refused — no structure at all", async () => {
    const server = spawn(); // no starting metal
    const { hostClient, tile } = await startedMatch(server, false);
    hostClient.send({ type: "game/build", kind: "miner", tile, seq: 1 });

    const seen: ServerMessage[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(await hostClient.waitFor((m) => m.type === "game/map-delta"));
    }
    expect(seen.every((m) => m.type === "game/map-delta" && m.builds === undefined)).toBe(true);
  });

  test("a miner is refused on bare ground", async () => {
    const { hostClient } = await startedMatch(funded(), false);
    const bare = { tx: 0, ty: 0 };
    hostClient.send({ type: "game/pos", pos: tileCenter(bare), seq: 2 });
    hostClient.send({ type: "game/build", kind: "miner", tile: bare, seq: 1 });

    const seen: ServerMessage[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(await hostClient.waitFor((m) => m.type === "game/map-delta"));
    }
    expect(seen.every((m) => m.type === "game/map-delta" && m.builds === undefined)).toBe(true);
  });

  test("the reconnect keyframe rebuilds the bank and every standing structure", async () => {
    const server = funded();
    const { client: hostClient, code } = await host(server, "Ana");
    const joinedFirst = (await joinLobby(server, code, "Ben")).joined;
    await hostClient.waitFor((m) => m.type === "lobby/player-joined");
    hostClient.send({ type: "game/start" });
    const init = expectMessage(
      await hostClient.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;
    const tile = nearestMetal(init.oreSeed);
    hostClient.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 });
    hostClient.send({ type: "game/build", kind: "miner", tile, seq: 1 });
    await hostClient.waitFor((m) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0);

    const back = await connect(server);
    back.send({ type: "lobby/join", code, name: "Ben", token: joinedFirst.you.token });
    const keyframe = expectMessage(
      await back.waitFor((m) => m.type === "game/build-init"),
      "game/build-init",
    );
    expect(keyframe.structures).toHaveLength(1);
    expect(keyframe.structures[0]).toMatchObject({ kind: "miner", tile, hp: 200 });
  });
});

describe("M4-T5: demolish returns 20% of the metal", () => {
  const MINER = BUILDABLES.miner as { cost: number };

  function nearestMetal(oreSeed: number): Tile {
    const ore = generateOre(ARENA, oreSeed);
    let best: Tile | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [key, kind] of ore) {
      if (kind !== "metal") continue;
      const t = { tx: Math.floor(key / 65_536), ty: key % 65_536 };
      const c = tileCenter(t);
      const d = Math.hypot(c.x - ARENA.width / 2, c.y - ARENA.height / 2);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) throw new Error("the generated grid holds no metal ore");
    return best;
  }

  test("any player can demolish a structure another placed; it vanishes for everyone", async () => {
    const server = startServer({ startingMetal: MINER.cost });
    servers.push(server);
    const { client: ana, code } = await host(server, "Ana");
    const { client: ben } = await joinLobby(server, code, "Ben");
    await ana.waitFor((m) => m.type === "lobby/player-joined");
    ana.send({ type: "game/start" });
    const init = expectMessage(
      await ana.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;

    const tile = nearestMetal(init.oreSeed);
    ana.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 });
    ana.send({ type: "game/build", kind: "miner", tile, seq: 1 });
    const spawned = expectMessage(
      await ana.waitFor((m) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0),
      "game/map-delta",
    );
    const id = spawned.builds?.[0]?.id as string;
    await ben.waitFor((m) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0);

    // Ben demolishes what Ana built — structures are communal, so there is no ownership check.
    ben.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 });
    ben.send({ type: "game/demolish", id, seq: 1 });

    const removed = (m: ServerMessage) =>
      m.type === "game/map-delta" && (m.removals ?? []).includes(id);
    expect(expectMessage(await ana.waitFor(removed), "game/map-delta").removals).toContain(id);
    expect(expectMessage(await ben.waitFor(removed), "game/map-delta").removals).toContain(id);
  });

  test("the refund lands in the shared bank", async () => {
    const server = startServer({ startingMetal: MINER.cost });
    servers.push(server);
    const { client: ana } = await host(server, "Ana");
    ana.send({ type: "game/start" });
    const init = expectMessage(
      await ana.waitFor((m) => m.type === "game/world-init"),
      "game/world-init",
    ).init;

    const tile = nearestMetal(init.oreSeed);
    ana.send({ type: "game/pos", pos: tileCenter(tile), seq: 1 });
    ana.send({ type: "game/build", kind: "miner", tile, seq: 1 });
    const spawned = expectMessage(
      await ana.waitFor((m) => m.type === "game/map-delta" && (m.builds?.length ?? 0) > 0),
      "game/map-delta",
    );
    // Placing spent the whole bank; only the refund can bring it back above zero this fast.
    ana.send({ type: "game/demolish", id: spawned.builds?.[0]?.id as string, seq: 1 });
    const refunded = expectMessage(
      await ana.waitFor((m) => m.type === "game/map-delta" && (m.bank?.metal ?? 0) > 0),
      "game/map-delta",
    );
    expect(refunded.bank?.metal).toBe(Math.floor(MINER.cost * 0.2));
  });

  test("demolishing a structure that is already gone changes nothing", async () => {
    const server = startServer({ startingMetal: MINER.cost });
    servers.push(server);
    const { client: ana } = await host(server, "Ana");
    ana.send({ type: "game/start" });
    await ana.waitFor((m) => m.type === "game/world-init");

    ana.send({ type: "game/demolish", id: "b999", seq: 1 });
    const seen: ServerMessage[] = [];
    for (let i = 0; i < 4; i++) seen.push(await ana.waitFor((m) => m.type === "game/map-delta"));
    expect(
      seen.every((m) => m.type === "game/map-delta" && m.removals === undefined && !m.bank),
    ).toBe(true);
  });
});

// The escape and its teardown, driven through a capture transport so the simultaneity check and
// the cleared interval can both be asserted deterministically.
describe("M4-T11: the whole squad in the door ends the match with a time", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }

  const TICK = 5;
  const endsFor = (t: Capture, socketId: string) =>
    t.sent.filter((m) => m.socketId === socketId && m.msg.type === "game/match-end");

  // A started match with `count` seated players, plus a handle on each one's id and socket.
  function match(count: number): { t: Capture; hub: LobbyHub; ids: string[]; sockets: string[] } {
    const t = new Capture();
    const hub = new LobbyHub(t, { tickMs: TICK });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "P1" }));
    const created = t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
    const ids = [created.you.id];
    const sockets = ["s1"];
    for (let i = 2; i <= count; i++) {
      const socketId = `s${i}`;
      hub.handleMessage(
        socketId,
        JSON.stringify({ type: "lobby/join", code: created.code, name: `P${i}` }),
      );
      const joined = t.sent.find((m) => m.socketId === socketId && m.msg.type === "lobby/joined")
        ?.msg as Extract<ServerMessage, { type: "lobby/joined" }>;
      ids.push(joined.you.id);
      sockets.push(socketId);
    }
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    return { t, hub, ids, sockets };
  }

  const worldOf = (t: Capture) =>
    (
      t.sent.find((m) => m.msg.type === "game/world-init")?.msg as
        | Extract<ServerMessage, { type: "game/world-init" }>
        | undefined
    )?.init;

  // The centre of the door, wherever this session happened to place it.
  const doorCentre = (t: Capture) => {
    const exit = worldOf(t)?.exit as { x: number; y: number; width: number; height: number };
    return { x: exit.x + exit.width / 2, y: exit.y + exit.height / 2 };
  };
  const walkTo = (hub: LobbyHub, socketId: string, pos: { x: number; y: number }, seq = 1) =>
    hub.handleMessage(socketId, JSON.stringify({ type: "game/pos", pos, seq }));
  const settle = () => new Promise((r) => setTimeout(r, TICK * 4));

  test("a partial squad in the door does not trigger the escape", async () => {
    const { t, hub, sockets } = match(2);
    walkTo(hub, sockets[0], doorCentre(t));
    walkTo(hub, sockets[1], { x: ARENA.width / 2, y: ARENA.height / 2 }); // still at spawn
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);
    hub.dispose();
  });

  test("everyone in at once triggers exactly one match-end, for every client", async () => {
    const { t, hub, sockets } = match(2);
    const door = doorCentre(t);
    walkTo(hub, sockets[0], door);
    walkTo(hub, sockets[1], { x: door.x + 10, y: door.y });
    await settle();

    for (const socketId of sockets) {
      const ends = endsFor(t, socketId);
      expect(ends).toHaveLength(1); // exactly one, however many ticks elapsed
      const end = ends[0].msg as Extract<ServerMessage, { type: "game/match-end" }>;
      expect(end.outcome).toBe("escaped");
      expect(end.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    hub.dispose();
  });

  test("a dead player standing in the door does not count — they must respawn and walk back", async () => {
    const { t, hub, sockets } = match(2);
    const door = doorCentre(t);
    walkTo(hub, sockets[0], door);
    walkTo(hub, sockets[1], { x: door.x + 10, y: door.y });
    hub.handleMessage(sockets[1], JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);

    hub.handleMessage(sockets[1], JSON.stringify({ type: "game/health", hp: 100, seq: 2 }));
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(1); // back on their feet in the door
    hub.dispose();
  });

  test("an in-grace player does not block the escape", async () => {
    const { t, hub, sockets } = match(2);
    const door = doorCentre(t);
    walkTo(hub, sockets[0], door);
    walkTo(hub, sockets[1], { x: ARENA.width / 2, y: ARENA.height / 2 }); // nowhere near it
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);

    hub.handleClose(sockets[1]); // their socket drops; the slot is held in grace
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(1);
    hub.dispose();
  });

  test("the sim timer is cleared, so no delta rides after the match ends", async () => {
    const { t, hub, sockets } = match(1);
    walkTo(hub, sockets[0], doorCentre(t));
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(1);

    const after = t.sent.length;
    await new Promise((r) => setTimeout(r, TICK * 10));
    expect(t.sent.length).toBe(after); // nothing more; the interval really is gone
    hub.dispose();
  });

  test("the escape is a simultaneity check, not a per-player check-in", async () => {
    const { t, hub, sockets } = match(2);
    const door = doorCentre(t);
    const centre = { x: ARENA.width / 2, y: ARENA.height / 2 };
    walkTo(hub, sockets[0], door, 1); // P1 arrives…
    await settle();
    walkTo(hub, sockets[0], centre, 2); // …and wanders back out
    walkTo(hub, sockets[1], door, 1); // P2 arrives only now
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0); // they were never both in at once
    hub.dispose();
  });
});

describe("M4-T12: a squad wipe ends the match in a loss", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }

  const TICK = 5;
  const endsFor = (t: Capture, socketId: string) =>
    t.sent.filter((m) => m.socketId === socketId && m.msg.type === "game/match-end");
  const settle = () => new Promise((r) => setTimeout(r, TICK * 4));

  function match(count: number): { t: Capture; hub: LobbyHub; sockets: string[] } {
    const t = new Capture();
    const hub = new LobbyHub(t, { tickMs: TICK });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "P1" }));
    const created = t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
    const sockets = ["s1"];
    for (let i = 2; i <= count; i++) {
      const socketId = `s${i}`;
      hub.handleMessage(
        socketId,
        JSON.stringify({ type: "lobby/join", code: created.code, name: `P${i}` }),
      );
      sockets.push(socketId);
    }
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    return { t, hub, sockets };
  }

  const report = (hub: LobbyHub, socketId: string, hp: number, seq = 1) =>
    hub.handleMessage(socketId, JSON.stringify({ type: "game/health", hp, seq }));

  test("a fresh match, where nobody has reported HP yet, is not a wipe", async () => {
    const { t, hub, sockets } = match(2);
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);
    hub.dispose();
  });

  test("one living player prevents the wipe", async () => {
    const { t, hub, sockets } = match(2);
    report(hub, sockets[0], 0);
    report(hub, sockets[1], 12);
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);
    hub.dispose();
  });

  test("every connected player dead ends the match at once, as a loss, for everyone", async () => {
    const { t, hub, sockets } = match(2);
    report(hub, sockets[0], 0);
    report(hub, sockets[1], 0);
    await settle();

    for (const socketId of sockets) {
      const ends = endsFor(t, socketId);
      expect(ends).toHaveLength(1);
      expect((ends[0].msg as Extract<ServerMessage, { type: "game/match-end" }>).outcome).toBe(
        "wiped",
      );
    }
    hub.dispose();
  });

  test("a player mid-respawn-countdown is dead for this purpose — no last-stand timer", async () => {
    // A downed client reports 0 and reports nothing else until it revives, so the countdown is
    // exactly the window in which the squad can be wiped.
    const { t, hub, sockets } = match(1);
    report(hub, sockets[0], 0);
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(1);
    hub.dispose();
  });

  test("an in-grace player does not keep the match alive", async () => {
    const { t, hub, sockets } = match(2);
    report(hub, sockets[1], 100); // P2 is alive…
    hub.handleClose(sockets[1]); // …then drops; the slot is held in grace
    report(hub, sockets[0], 0); // the last connected player dies
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(1);
    hub.dispose();
  });

  test("a session with nobody connected is paused, not lost", async () => {
    const { t, hub, sockets } = match(1);
    hub.handleClose(sockets[0]);
    await settle();
    expect(endsFor(t, sockets[0])).toHaveLength(0);
    hub.dispose();
  });

  test("exactly one match-end fires and the sim timer is cleared", async () => {
    const { t, hub, sockets } = match(1);
    report(hub, sockets[0], 0);
    await settle();
    const after = t.sent.length;
    await new Promise((r) => setTimeout(r, TICK * 10));
    expect(t.sent.length).toBe(after); // no further deltas, no second end
    expect(endsFor(t, sockets[0])).toHaveLength(1);
    hub.dispose();
  });
});

describe("M4 review: a finished match stays finished", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }
  const TICK = 5;
  const settle = () => new Promise((r) => setTimeout(r, TICK * 4));
  const sentTo = (t: Capture, socketId: string, type: ServerMessage["type"]) =>
    t.sent.filter((m) => m.socketId === socketId && m.msg.type === type);

  // A solo match wiped to a close, plus the token needed to rejoin it.
  async function endedMatch(): Promise<{ t: Capture; hub: LobbyHub; code: string; token: string }> {
    const t = new Capture();
    const hub = new LobbyHub(t, { tickMs: TICK, startingMetal: 1_000 });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "P1" }));
    const created = t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    await settle();
    return { t, hub, code: created.code, token: created.you.token };
  }

  test("a player rejoining after the end gets the result, not a dead world", async () => {
    const { t, hub, code, token } = await endedMatch();
    hub.handleClose("s1");
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/join", code, name: "P1", token }));

    // Handing back world-init would put them in a box whose sim stopped ticking, with no route
    // to the end screen.
    expect(sentTo(t, "s2", "game/world-init")).toHaveLength(0);
    const ends = sentTo(t, "s2", "game/match-end");
    expect(ends).toHaveLength(1);
    const end = ends[0].msg as Extract<ServerMessage, { type: "game/match-end" }>;
    expect(end.outcome).toBe("wiped");
    hub.dispose();
  });

  test("the reported time is frozen at the end, not recomputed on rejoin", async () => {
    const { t, hub, code, token } = await endedMatch();
    const first = (
      sentTo(t, "s1", "game/match-end")[0].msg as Extract<ServerMessage, { type: "game/match-end" }>
    ).elapsedMs;
    await new Promise((r) => setTimeout(r, 60));
    hub.handleClose("s1");
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/join", code, name: "P1", token }));
    const rejoined = (
      sentTo(t, "s2", "game/match-end")[0].msg as Extract<ServerMessage, { type: "game/match-end" }>
    ).elapsedMs;
    expect(rejoined).toBe(first);
    hub.dispose();
  });

  test("in-game commands are ignored once the match is over", async () => {
    // Two players, so a relayed position is observable: with one, `game/pos` fans out to nobody
    // and the test could not tell a working guard from a broken one.
    const t = new Capture();
    const hub = new LobbyHub(t, { tickMs: TICK });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "P1" }));
    const created = t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/join", code: created.code, name: "P2" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));

    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: { x: 1, y: 1 }, seq: 1 }));
    expect(sentTo(t, "s2", "game/peer-pos")).toHaveLength(1); // relayed while the match is live

    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    hub.handleMessage("s2", JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    await settle();
    expect(sentTo(t, "s1", "game/match-end")).toHaveLength(1);

    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: { x: 2, y: 2 }, seq: 2 }));
    expect(sentTo(t, "s2", "game/peer-pos")).toHaveLength(1); // still 1: the guard held
    hub.dispose();
  });
});

describe("M5-I5: shots and turret aims reach the client, and only the ones the sim applied", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }
  const TICK = 10;
  const deltas = (t: Capture) =>
    t.sent
      .filter((m) => m.msg.type === "game/map-delta")
      .map((m) => m.msg as Extract<ServerMessage, { type: "game/map-delta" }>);
  const created = (t: Capture) =>
    t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
  const buildInit = (t: Capture, socketId: string) => {
    const found = t.sent.find((m) => m.socketId === socketId && m.msg.type === "game/build-init");
    if (!found) throw new Error("no build-init reached that socket");
    return found.msg as Extract<ServerMessage, { type: "game/build-init" }>;
  };

  // A spawn re-read as the place to shoot it from: on the line from arena centre through wherever the
  // grunt has walked to, just behind it. Both halves of that matter since #125 — an un-aggroed enemy
  // wanders on a heading of its own, so the announced spawn point is stale; and an origin exactly on
  // the enemy leaves the whole-unit rounding of the stream (#84) to decide whether it counts as in
  // front of the ray or behind it. `BEHIND` clears that rounding, and stays small enough that the
  // grunt's own nest — up to 300 u of jitter away — cannot slip in between and take the shot.
  const firingSpot = (t: Capture, spawn: EnemySpawn): EnemySpawn => {
    let at = spawn.pos;
    for (const d of deltas(t)) for (const [id, x, y] of d.moves) if (id === spawn.id) at = { x, y };
    const aim = aimAt(at, { x: ARENA.width / 2, y: ARENA.height / 2 });
    return { ...spawn, pos: { x: at.x - aim.x * BEHIND, y: at.y - aim.y * BEHIND } };
  };

  // A solo match already one wave in, with a grunt to shoot at and metal to build with.
  async function fighting(): Promise<{ t: Capture; hub: LobbyHub; me: string; grunt: EnemySpawn }> {
    const t = new Capture();
    // Fixed rng: every assertion below is downstream of where the first wave scattered its grunts,
    // so an unseeded hub would run these against a different world every time. Not 0.5 — that is
    // the zero-jitter midpoint, which would stack every grunt exactly on its nest.
    const hub = new LobbyHub(t, {
      tickMs: TICK,
      firstWaveMs: 5,
      startingMetal: 1_000,
      startingAmmo: 9, // these are weapon tests; the pool is #102's own business
      rng: () => 0.75,
    });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Solo" }));
    const me = created(t).you.id;
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    await sleep(TICK * 3);
    const spawned = deltas(t).flatMap((d) => d.spawns ?? [])[0];
    if (!spawned) throw new Error("the first wave spawned nothing");
    // `grunt.pos` is where the player stands, not where the grunt is — see `firingSpot`.
    const grunt = firingSpot(t, spawned);
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: grunt.pos, seq: 1 }));
    return { t, hub, me, grunt };
  }

  const aimAt = (from: Vec2, to: Vec2): Vec2 => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  };

  // #85: the client gate is a courtesy; this is the one that counts. A dead player has not moved,
  // so `admitAttack`'s position check passes and nothing else was looking at their HP.
  //
  // Two players deliberately: in a solo match one player at 0 HP is a squad wipe, the match ends,
  // and `inPlay` refuses everything afterwards — which would pass this test without the gate
  // existing at all. The teammate keeps the match running so the gate is what is measured.
  async function squadOfTwoFighting(): Promise<{
    t: Capture;
    hub: LobbyHub;
    grunt: EnemySpawn;
    dir: Vec2;
  }> {
    const t = new Capture();
    const hub = new LobbyHub(t, {
      tickMs: TICK,
      firstWaveMs: 5,
      startingMetal: 1_000,
      startingAmmo: 9, // these are weapon tests; the pool is #102's own business
      rng: () => 0.75,
    });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Ana" }));
    const code = created(t).code;
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/join", code, name: "Ben" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    await sleep(TICK * 3);
    const spawned = deltas(t).flatMap((d) => d.spawns ?? [])[0];
    if (!spawned) throw new Error("the first wave spawned nothing");
    const grunt = firingSpot(t, spawned);
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: grunt.pos, seq: 1 }));
    hub.handleMessage("s2", JSON.stringify({ type: "game/health", hp: 100, seq: 1 })); // Ben lives
    return { t, hub, grunt, dir: aimAt(grunt.pos, { x: ARENA.width / 2, y: ARENA.height / 2 }) };
  }

  test("a shot from a player the server believes is dead is refused", async () => {
    const { t, hub, grunt, dir } = await squadOfTwoFighting();
    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 0, seq: 2 }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 1 }));
    await sleep(TICK * 3);
    hub.dispose();
    expect(t.sent.some((m) => m.msg.type === "game/match-end")).toBe(false); // still in play
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toEqual([]); // no line, and no damage
  });

  test("and it is admitted again once they report themselves back up", async () => {
    const { t, hub, grunt, dir } = await squadOfTwoFighting();
    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 0, seq: 2 }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 1 }));
    await sleep(TICK * 3);
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toEqual([]);

    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 100, seq: 3 }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 2 }));
    await sleep(TICK * 3);
    hub.dispose();
    // The refusal must not have burned the seq or the cadence, or being dead would cost a shot.
    expect(deltas(t).flatMap((d) => d.shots ?? []).length).toBeGreaterThan(0);
  });

  test("an admitted shot rides the delta as a PeerShot naming what the sim damaged", async () => {
    const { t, hub, me, grunt } = await fighting();
    const dir = aimAt(grunt.pos, { x: ARENA.width / 2, y: ARENA.height / 2 });
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 1 }));
    await sleep(TICK * 3);
    hub.dispose();
    const struck = deltas(t).find((d) => (d.shots ?? []).length > 0);
    const shot = struck?.shots?.[0];
    if (!shot) throw new Error("the admitted shot never reached the wire");
    expect(shot.id).toBe(me);
    // The wire carries three decimals (#84) — under half a world unit of lateral drift at
    // RANGED_RANGE, and it swallows whole the ULP wobble admission's re-normalisation adds
    // (dividing an already-unit vector through its own length moves it by up to an ULP).
    expect(shot.dir.x).toBe(Math.round(shot.dir.x * 1000) / 1000); // quantised on the way out
    expect(shot.dir.y).toBe(Math.round(shot.dir.y * 1000) / 1000);
    expect(shot.dir.x).toBeCloseTo(dir.x, 2); // and still the aim that was sent
    expect(shot.dir.y).toBeCloseTo(dir.y, 2);
    // Whatever the ray reached first, the same delta has to show the sim writing that thing's HP.
    // Asserting the invariant rather than the geometry keeps this honest about which target won.
    // `hit` is optional because a miss carries none, so pin that this shot connected at all —
    // without it a shot that hit nothing would satisfy the membership check vacuously.
    if (shot.hit === undefined) throw new Error("the admitted shot reported no target");
    expect([
      ...(struck?.hits ?? []).map((h) => h.id),
      ...(struck?.deaths ?? []),
      ...(struck?.nests ?? []).map((n) => n.id),
    ]).toContain(shot.hit);
  });

  test("a shot refused for cadence produces no PeerShot at all", async () => {
    const { t, hub, me, grunt } = await fighting();
    const dir = aimAt(grunt.pos, { x: ARENA.width / 2, y: ARENA.height / 2 });
    // Two clicks in the same instant: the second is inside RANGED_CADENCE_MS, so the hub refuses
    // it. A refused attack never enters `pendingAttacks`, so it never becomes a line.
    for (const seq of [1, 2]) {
      hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq }));
    }
    await sleep(TICK * 3);
    hub.dispose();
    expect(
      deltas(t)
        .flatMap((d) => d.shots ?? [])
        .filter((s) => s.id === me),
    ).toHaveLength(1);
  });

  test("a shot refused for teleport-aim produces no PeerShot", async () => {
    const { t, hub, grunt } = await fighting();
    const far = { x: grunt.pos.x + ATTACK_POS_TOLERANCE + 1, y: grunt.pos.y };
    const dir = aimAt(far, grunt.pos);
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: far, dir, seq: 1 }));
    await sleep(TICK * 3);
    hub.dispose();
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toEqual([]);
  });

  test("a shot refused for a stale seq produces no PeerShot", async () => {
    const { t, hub, me, grunt } = await fighting();
    const dir = aimAt(grunt.pos, { x: ARENA.width / 2, y: ARENA.height / 2 });
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 5 }));
    await sleep(RANGED_CADENCE_MS + TICK); // let the cadence clear, so only the seq can refuse
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 4 }));
    await sleep(TICK * 3);
    hub.dispose();
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toHaveLength(1);
    expect(deltas(t).flatMap((d) => d.shots ?? [])[0].id).toBe(me);
  });

  test("an absurd reported aim reaches the squad normalized, never as reported", async () => {
    const { t, hub, grunt } = await fighting();
    // `asVec2` only checks finiteness, so this is what a hostile client can actually send. Drawn
    // raw it would blow up every other player's canvas path.
    const dir = { x: 1e300, y: 0 };
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 1 }));
    await sleep(TICK * 3);
    hub.dispose();
    const shots = deltas(t).flatMap((d) => d.shots ?? []);
    expect(shots).toHaveLength(1);
    expect(shots[0].dir).toEqual({ x: 1, y: 0 });
  });

  test("a zero-length aim produces no PeerShot — it would relay as a NaN line", async () => {
    const { t, hub, grunt } = await fighting();
    const dir = { x: 0, y: 0 };
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: grunt.pos, dir, seq: 1 }));
    await sleep(TICK * 3);
    hub.dispose();
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toEqual([]);
  });

  test("nothing fired means no shots field on the wire at all", async () => {
    const { t, hub } = await fighting();
    await sleep(TICK * 3);
    hub.dispose();
    expect(deltas(t).every((d) => d.shots === undefined)).toBe(true);
  });

  test("a turret that engages with no grid behind it streams the unpowered aim", async () => {
    const { t, hub, grunt } = await fighting();
    const spot = tileOf({ x: grunt.pos.x + 100, y: grunt.pos.y });
    hub.handleMessage(
      "s1",
      JSON.stringify({ type: "game/build", kind: "turret", tile: spot, seq: 1 }),
    );
    await sleep(TICK * 4);
    hub.dispose();
    const placed = deltas(t).flatMap((d) => d.builds ?? [])[0];
    expect(placed?.kind).toBe("turret");
    const aim = deltas(t)
      .flatMap((d) => d.aims ?? [])
      .find(([id]) => id === placed?.id);
    expect(aim?.[1]).toBeTruthy(); // holding a target
    expect(aim?.[2]).toBe(0); // no generator standing, so it draws the lightning instead of firing
  });

  test("the reconnect keyframe sends enemy-init before build-init, since aims name enemy ids", async () => {
    const { t, hub } = await fighting();
    const { code, you } = created(t);
    hub.handleClose("s1");
    hub.handleMessage(
      "s2",
      JSON.stringify({ type: "lobby/join", code, name: "Solo", token: you.token }),
    );
    hub.dispose();
    const order = t.sent.filter((m) => m.socketId === "s2").map((m) => m.msg.type);
    expect(order).toContain("game/enemy-init");
    expect(order.indexOf("game/enemy-init")).toBeLessThan(order.indexOf("game/build-init"));
  });

  test("build-init carries aims, so a reconnecter sees the lines already in flight", async () => {
    const { t, hub, grunt } = await fighting();
    const { code, you } = created(t);
    hub.handleMessage(
      "s1",
      JSON.stringify({
        type: "game/build",
        kind: "turret",
        tile: tileOf({ x: grunt.pos.x + 100, y: grunt.pos.y }),
        seq: 1,
      }),
    );
    await sleep(TICK * 4);
    hub.handleClose("s1");
    hub.handleMessage(
      "s2",
      JSON.stringify({ type: "lobby/join", code, name: "Solo", token: you.token }),
    );
    hub.dispose();
    const keyframe = buildInit(t, "s2");
    expect(keyframe.aims).toHaveLength(1);
    expect(keyframe.aims[0][2]).toBe(0);
  });
});

// #102 stage 2: the squad's bullets are server state. The client may ask for one and may report a
// shot, but only the hub decides whether either is paid for.
describe("#102: bullets are server-owned, and a shot spends one", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }
  const TICK = 50;
  // One socket's stream. Every delta is broadcast to the whole squad, so reading the raw capture
  // would count each one twice in a two-player match.
  const deltas = (t: Capture, socketId = "s1") =>
    t.sent
      .filter((m) => m.socketId === socketId && m.msg.type === "game/map-delta")
      .map((m) => m.msg as Extract<ServerMessage, { type: "game/map-delta" }>);
  const ammoStream = (t: Capture, socketId = "s1") =>
    deltas(t, socketId)
      .map((d) => d.ammo)
      .filter((a) => a !== undefined);
  const created = (t: Capture) =>
    t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;

  // A live two-player match with a manual clock, so a one-second forge is twenty virtual ticks
  // rather than a real second of sleeping. Ben never reports HP, so he is alive and the match
  // cannot end while Ana is being knocked around.
  function match(config: Partial<LobbyConfig> = {}) {
    const t = new Capture();
    const clock = new ManualScheduler();
    const hub = new LobbyHub(t, {
      tickMs: TICK,
      firstWaveMs: 5,
      scheduler: clock,
      rng: () => 0.75,
      ...config,
    });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "Ana" }));
    hub.handleMessage(
      "s2",
      JSON.stringify({ type: "lobby/join", code: created(t).code, name: "Ben" }),
    );
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    return { t, hub, clock };
  }

  // The same match, one wave in, with Ana standing on a grunt so her shots reach it.
  function fighting(config: Partial<LobbyConfig> = {}) {
    const { t, hub, clock } = match(config);
    clock.advance(TICK);
    const spawned = deltas(t).flatMap((d) => d.spawns ?? [])[0];
    if (!spawned) throw new Error("the first wave spawned nothing");
    // A firing spot rather than the announced spawn point: an un-aggroed enemy wanders on a heading of
    // its own (#125), so where it was created is stale, and an origin exactly on it leaves the stream's
    // whole-unit rounding to decide whether the ray points at it or away.
    let walked = spawned.pos;
    for (const d of deltas(t)) {
      for (const [id, x, y] of d.moves) if (id === spawned.id) walked = { x, y };
    }
    const toEnemy = {
      x: ARENA.width / 2 - walked.x,
      y: ARENA.height / 2 - walked.y,
    };
    const reach = Math.hypot(toEnemy.x, toEnemy.y) || 1;
    const grunt = {
      ...spawned,
      pos: {
        x: walked.x - (toEnemy.x / reach) * BEHIND,
        y: walked.y - (toEnemy.y / reach) * BEHIND,
      },
    };
    hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: grunt.pos, seq: 1 }));
    const toCentre = {
      x: ARENA.width / 2 - grunt.pos.x,
      y: ARENA.height / 2 - grunt.pos.y,
    };
    const len = Math.hypot(toCentre.x, toCentre.y) || 1;
    return { t, hub, clock, grunt, dir: { x: toCentre.x / len, y: toCentre.y / len } };
  }

  const shoot = (hub: LobbyHub, at: Vec2, dir: Vec2, seq = 1) =>
    hub.handleMessage("s1", JSON.stringify({ type: "game/attack", pos: at, dir, seq }));

  test("Metal leaves the bank at the order, and the bullet arrives a forge later", () => {
    const { t, hub, clock } = match({ startingMetal: BULLET_COST });
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    clock.advance(TICK);
    expect(deltas(t).at(-1)?.bank).toEqual({ metal: 0 }); // charged before any bullet exists
    expect(ammoStream(t)).toEqual([]);

    clock.advance(FORGE_MS - TICK);
    expect(ammoStream(t)).toEqual([1]);
    hub.dispose();
  });

  test("an order the bank cannot cover changes nothing", () => {
    const { t, hub, clock } = match({ startingMetal: BULLET_COST - 1 });
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    clock.advance(FORGE_MS * 2);
    expect(ammoStream(t)).toEqual([]);
    expect(deltas(t).flatMap((d) => (d.bank ? [d.bank] : []))).toEqual([]); // bank never moved
    hub.dispose();
  });

  test("ammo rides a delta only on the ticks it moved", () => {
    const { t, hub, clock } = match({ startingMetal: 2 * BULLET_COST });
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    clock.advance(FORGE_MS * 3); // 60 ticks, two of which deliver a bullet
    expect(ammoStream(t)).toEqual([1, 2]);
    hub.dispose();
  });

  test("a client at zero ammo cannot shoot — no damage reaches the enemy, and no line is drawn", () => {
    const { t, hub, clock, grunt, dir } = fighting({ startingMetal: 1_000 });
    shoot(hub, grunt.pos, dir);
    clock.advance(TICK * 3);
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toEqual([]);
    expect(deltas(t).flatMap((d) => d.hits ?? [])).toEqual([]);
    hub.dispose();
  });

  test("with a bullet in the pool the same shot lands, and the pool drops by exactly one", () => {
    const { t, hub, clock, grunt, dir } = fighting({ startingAmmo: 2 });
    shoot(hub, grunt.pos, dir);
    clock.advance(TICK * 3);
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toHaveLength(1);
    expect(ammoStream(t)).toEqual([1]);
    hub.dispose();
  });

  test("the pool empties, and the shot after the last bullet is refused", () => {
    const { t, hub, clock, grunt, dir } = fighting({ startingAmmo: 1 });
    shoot(hub, grunt.pos, dir, 1);
    clock.advance(RANGED_CADENCE_MS + TICK);
    shoot(hub, grunt.pos, dir, 2);
    clock.advance(TICK * 3);
    expect(deltas(t).flatMap((d) => d.shots ?? [])).toHaveLength(1);
    expect(ammoStream(t)).toEqual([0]);
    hub.dispose();
  });

  test("the queue keeps forging through the death of whoever ordered it", () => {
    const { t, hub, clock } = match({ startingMetal: BULLET_COST });
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    hub.handleMessage("s1", JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    clock.advance(FORGE_MS);
    expect(ammoStream(t)).toEqual([1]);
    hub.dispose();
  });

  test("and through their disconnect — the queue is the squad's, not theirs", () => {
    const { t, hub, clock } = match({ startingMetal: BULLET_COST });
    hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
    hub.handleClose("s1");
    clock.advance(FORGE_MS);
    expect(ammoStream(t, "s2")).toEqual([1]);
    hub.dispose();
  });

  test("the reconnect keyframe carries the live pool, so a rejoiner can shoot", () => {
    const { t, hub, clock } = match({ startingAmmo: 4 });
    clock.advance(TICK);
    hub.handleMessage(
      "s3",
      JSON.stringify({ type: "lobby/join", code: created(t).code, name: "Cass" }),
    );
    const keyframe = t.sent.find(
      (m) => m.socketId === "s3" && m.msg.type === "game/build-init",
    )?.msg;
    expect(keyframe).toMatchObject({ type: "game/build-init", ammo: 4 });
    hub.dispose();
  });

  // #102 stage 3. The HUD's queue circle counts bullets ordered and not yet forged, and no client
  // can work that out for itself: a bullet arriving says one finished, never whether another is
  // behind it. So the count rides, on the bank's terms — only on the ticks it actually moved.
  describe("stage 3: the queue's depth rides the wire, and the phase behind it does not", () => {
    const queuedStream = (t: Capture, socketId = "s1") =>
      deltas(t, socketId)
        .map((d) => d.queued)
        .filter((q) => q !== undefined);

    test("an order raises the queue, and the bullet it becomes lowers it again", () => {
      const { t, hub, clock } = match({ startingMetal: BULLET_COST });
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(TICK);
      expect(queuedStream(t)).toEqual([1]);
      clock.advance(FORGE_MS);
      expect(queuedStream(t)).toEqual([1, 0]);
      hub.dispose();
    });

    test("a settled tick carries no queue at all", () => {
      const { t, hub, clock } = match({ startingMetal: BULLET_COST });
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(FORGE_MS * 3); // 60 ticks; the queue moved on exactly two of them
      expect(queuedStream(t)).toEqual([1, 0]);
      hub.dispose();
    });

    test("three orders drain one at a time, so the depth counts down rather than collapsing", () => {
      const { t, hub, clock } = match({ startingMetal: 3 * BULLET_COST });
      for (let i = 0; i < 3; i++) hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(FORGE_MS * 4);
      expect(queuedStream(t)).toEqual([3, 2, 1, 0]);
      hub.dispose();
    });

    // The countdown on the head bullet is deliberately absent: it moves every tick, so putting it
    // on the wire would turn a sparse field into a per-tick one and still only step at 20 Hz.
    test("no per-tick forge countdown is broadcast", () => {
      const { t, hub, clock } = match({ startingMetal: BULLET_COST });
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(FORGE_MS);
      for (const d of deltas(t)) expect(d).not.toHaveProperty("forgeMs");
      hub.dispose();
    });

    test("the reconnect keyframe carries the queue, so a rejoiner sees what is still coming", () => {
      const { t, hub, clock } = match({ startingMetal: 2 * BULLET_COST });
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(TICK);
      hub.handleMessage(
        "s3",
        JSON.stringify({ type: "lobby/join", code: created(t).code, name: "Cass" }),
      );
      const keyframe = t.sent.find(
        (m) => m.socketId === "s3" && m.msg.type === "game/build-init",
      )?.msg;
      expect(keyframe).toMatchObject({ type: "game/build-init", ammo: 0, queued: 2 });
      hub.dispose();
    });
  });

  // #102 stage 4. A turret shoots the squad's bullets, not free ones — the same pool a player
  // spends from, so the two genuinely compete for the last one.
  //
  // The turret is stood in front of a nest with no wave ever due, which is what makes the pool the
  // only variable: a nest is a legitimate target that is always there, never moves and is damaged
  // by nothing else in the match, so every `nests` delta below is a turret shot and each one is
  // a bullet. The player shoots from the arena centre, at least 3,600 u from the nearest nest
  // (#123's inner bound) and far beyond her own 700 u reach, so her ray can never touch the same
  // observable.
  describe("stage 4: turrets draw from the squad's pool", () => {
    const CENTRE = { x: ARENA.width / 2, y: ARENA.height / 2 };
    const NO_WAVE = 10_000_000; // no grunt ever spawns; the nest is the turret's only target

    const worldInit = (t: Capture) =>
      t.sent.find((m) => m.msg.type === "game/world-init")?.msg as Extract<
        ServerMessage,
        { type: "game/world-init" }
      >;

    // The nearest tile of power ore the generated grid actually holds, so the generator is placed
    // through admission rather than around it.
    function nearestPowerTile(oreSeed: number): Tile {
      let best: Tile | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const [key, kind] of generateOre(ARENA, oreSeed)) {
        if (kind !== "power") continue;
        const tile = { tx: Math.floor(key / 65_536), ty: key % 65_536 };
        const c = tileCenter(tile);
        const d = Math.hypot(c.x - CENTRE.x, c.y - CENTRE.y);
        if (d < bestDist) {
          bestDist = d;
          best = tile;
        }
      }
      if (!best) throw new Error("the generated grid holds no power ore");
      return best;
    }

    // A match with one powered turret engaging a nest and no waves. Ana raises the grid and then
    // stands at the centre; Ben places the turret, so the two placements never share a cadence.
    function besieging(config: Partial<LobbyConfig> = {}) {
      const { t, hub, clock } = match({ startingMetal: 1_000, firstWaveMs: NO_WAVE, ...config });
      const power = nearestPowerTile(worldInit(t).init.oreSeed);
      hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: tileCenter(power), seq: 1 }));
      hub.handleMessage(
        "s1",
        JSON.stringify({ type: "game/build", kind: "generator", tile: power, seq: 1 }),
      );
      hub.handleMessage("s1", JSON.stringify({ type: "game/pos", pos: CENTRE, seq: 2 }));

      // Off the session's own seed, which is also how the client finds it (ADR 0004). An isolated
      // nest, because since #123 nests may cluster and a turret shoots whichever is nearest — with
      // a neighbour in range there would be no telling which one the `nests` deltas are about.
      const layout = nestLayout(ARENA, worldInit(t).init.nestSeed);
      const nest = layout.find((n) =>
        layout.every(
          (other) =>
            other.id === n.id ||
            Math.hypot(other.pos.x - n.pos.x, other.pos.y - n.pos.y) > 2 * TURRET_RANGE,
        ),
      );
      if (!nest) throw new Error("every nest in this layout has a neighbour in turret range");
      const spot = tileOf({ x: nest.pos.x - 300, y: nest.pos.y });
      hub.handleMessage(
        "s2",
        JSON.stringify({ type: "game/pos", pos: footprintCenter(spot, 2), seq: 1 }),
      );
      hub.handleMessage(
        "s2",
        JSON.stringify({ type: "game/build", kind: "turret", tile: spot, seq: 1 }),
      );
      return { t, hub, clock, nest };
    }
    // Every nest HP the squad has been told about. One entry per turret shot that landed.
    const nestHps = (t: Capture) =>
      deltas(t)
        .flatMap((d) => d.nests ?? [])
        .map((n) => n.hp);
    const shotsFired = (t: Capture) => deltas(t).flatMap((d) => d.shots ?? []);
    // The turret, aimed at the nest and holding a power slot. Asserted wherever a test's evidence
    // is an *absent* nest delta, so "it held its fire" cannot be satisfied by a turret that was
    // never standing, never targeting, or never powered.
    const expectEngaged = (t: Capture, nest: Nest) => {
      const aim = deltas(t).flatMap((d) => d.aims ?? [])[0];
      expect(aim?.[1]).toBe(nest.id);
      expect(aim?.[2]).toBe(1);
    };
    const aimAt = (from: Vec2, to: Vec2): Vec2 => {
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
    };

    test("a turret's shot comes out of the pool a player shoots from", () => {
      const { t, hub, clock, nest } = besieging({ startingAmmo: 2 });
      clock.advance(TICK);
      expect(nestHps(t)).toEqual([nest.hp - TURRET_DAMAGE]);
      expect(ammoStream(t)).toEqual([1]);
      hub.dispose();
    });

    test("an empty pool holds the turret's fire — it does not shoot free", () => {
      const { t, hub, clock, nest } = besieging({ startingAmmo: 0 });
      clock.advance(TURRET_CADENCE_MS * 10);
      expectEngaged(t, nest);
      expect(nestHps(t)).toEqual([]);
      hub.dispose();
    });

    test("and the first bullet the forge delivers is the one it fires", () => {
      const { t, hub, clock, nest } = besieging({ startingAmmo: 0 });
      clock.advance(TURRET_CADENCE_MS * 10);
      hub.handleMessage("s1", JSON.stringify({ type: "game/forge" }));
      clock.advance(FORGE_MS);
      expect(nestHps(t)).toEqual([nest.hp - TURRET_DAMAGE]);
      hub.dispose();
    });

    // The race, both ways round, on one bullet. The turret spends on the tick and a player spends
    // the instant their report is admitted, so which of the two happens first is the whole test —
    // and it is the ordering of these two statements, not any rule about who outranks whom.
    test("a player who asks before the tick takes the last bullet, and the turret holds fire", () => {
      const { t, hub, clock, nest } = besieging({ startingAmmo: 1 });
      hub.handleMessage(
        "s1",
        JSON.stringify({
          type: "game/attack",
          pos: CENTRE,
          dir: aimAt(CENTRE, { x: CENTRE.x + 1, y: CENTRE.y }),
          seq: 1,
        }),
      );
      clock.advance(TURRET_CADENCE_MS * 10);
      expect(shotsFired(t)).toHaveLength(1); // hers, and only hers
      expectEngaged(t, nest);
      expect(nestHps(t)).toEqual([]); // the turret found the pool empty
      hub.dispose();
    });

    test("a turret that took it on the tick leaves the player's next shot refused", () => {
      const { t, hub, clock, nest } = besieging({ startingAmmo: 1 });
      clock.advance(TICK);
      hub.handleMessage(
        "s1",
        JSON.stringify({
          type: "game/attack",
          pos: CENTRE,
          dir: aimAt(CENTRE, { x: CENTRE.x + 1, y: CENTRE.y }),
          seq: 1,
        }),
      );
      clock.advance(TURRET_CADENCE_MS * 10);
      expect(nestHps(t)).toEqual([nest.hp - TURRET_DAMAGE]); // one shot, from the one bullet
      expect(shotsFired(t)).toEqual([]); // and nothing left for her
      hub.dispose();
    });
  });
});

// #93: the door is revealed to the whole squad the moment anyone comes close enough, and stays
// revealed for the rest of the match. Virtual time throughout — the assertion is about the tick a
// flag rides on, which a real interval cannot promise.
describe("#93: finding the door", () => {
  class Capture implements Transport {
    readonly sent: { socketId: string; msg: ServerMessage }[] = [];
    send(socketId: string, msg: ServerMessage): void {
      this.sent.push({ socketId, msg });
    }
    close(): void {}
  }

  const TICK = 50;
  const CENTRE = { x: ARENA.width / 2, y: ARENA.height / 2 };

  const deltas = (t: Capture, socketId: string) =>
    t.sent
      .filter((m) => m.socketId === socketId && m.msg.type === "game/map-delta")
      .map((m) => m.msg as Extract<ServerMessage, { type: "game/map-delta" }>);
  const reveals = (t: Capture, socketId: string) =>
    deltas(t, socketId).filter((d) => d.exitRevealed !== undefined);
  const keyframeFor = (t: Capture, socketId: string) =>
    t.sent.find((m) => m.socketId === socketId && m.msg.type === "game/enemy-init")?.msg as
      | Extract<ServerMessage, { type: "game/enemy-init" }>
      | undefined;

  // A started match of `count` players. The wave clock is left at its default, so nothing spawns:
  // this block is about a distance to a door, and a wave marching into it would only add noise.
  function match(count: number) {
    const t = new Capture();
    const clock = new ManualScheduler();
    const hub = new LobbyHub(t, { tickMs: TICK, scheduler: clock });
    hub.handleMessage("s1", JSON.stringify({ type: "lobby/create", name: "P1" }));
    const created = t.sent[0].msg as Extract<ServerMessage, { type: "lobby/created" }>;
    const tokens = [created.you.token];
    for (let i = 2; i <= count; i++) {
      hub.handleMessage(
        `s${i}`,
        JSON.stringify({ type: "lobby/join", code: created.code, name: `P${i}` }),
      );
      const joined = t.sent.find((m) => m.socketId === `s${i}` && m.msg.type === "lobby/joined")
        ?.msg as Extract<ServerMessage, { type: "lobby/joined" }>;
      tokens.push(joined.you.token);
    }
    hub.handleMessage("s1", JSON.stringify({ type: "game/start" }));
    const init = t.sent.find((m) => m.msg.type === "game/world-init")?.msg as Extract<
      ServerMessage,
      { type: "game/world-init" }
    >;
    return { t, hub, clock, code: created.code, tokens, exit: init.init.exit };
  }

  // A point exactly `away` units from the nearest edge of the door, straight out from the face it
  // presents to the arena — so the number under test is the distance itself, not an approximation.
  function offDoor(exit: Exit, away: number): Vec2 {
    if (exit.width > exit.height) {
      // The door lies along the top or bottom wall.
      return { x: exit.x + exit.width / 2, y: exit.y === 0 ? exit.height + away : exit.y - away };
    }
    return { x: exit.x === 0 ? exit.width + away : exit.x - away, y: exit.y + exit.height / 2 };
  }

  const walkTo = (hub: LobbyHub, socketId: string, pos: Vec2, seq = 1) =>
    hub.handleMessage(socketId, JSON.stringify({ type: "game/pos", pos, seq }));

  test("a squad nowhere near the door is never told where it is", () => {
    const { t, hub, clock } = match(1);
    walkTo(hub, "s1", CENTRE);
    clock.advance(TICK * 10);
    expect(reveals(t, "s1")).toHaveLength(0);
    hub.dispose();
  });

  test("1,800 u from the door finds it", () => {
    const { t, hub, clock, exit } = match(1);
    walkTo(hub, "s1", offDoor(exit, 1_800));
    clock.advance(TICK);
    expect(reveals(t, "s1").map((d) => d.exitRevealed)).toEqual([true]);
    hub.dispose();
  });

  test("1,801 u does not", () => {
    const { t, hub, clock, exit } = match(1);
    walkTo(hub, "s1", offDoor(exit, 1_801));
    clock.advance(TICK * 5);
    expect(reveals(t, "s1")).toHaveLength(0);
    hub.dispose();
  });

  test("one player finding it reveals it on every other client", () => {
    const { t, hub, clock, exit } = match(3);
    walkTo(hub, "s1", CENTRE);
    walkTo(hub, "s2", CENTRE);
    walkTo(hub, "s3", offDoor(exit, 100));
    clock.advance(TICK);
    for (const socketId of ["s1", "s2", "s3"]) {
      expect(reveals(t, socketId).map((d) => d.exitRevealed)).toEqual([true]);
    }
    hub.dispose();
  });

  test("the flag rides the one tick it flips and never again", () => {
    const { t, hub, clock, exit } = match(1);
    walkTo(hub, "s1", offDoor(exit, 100));
    clock.advance(TICK * 40);
    expect(deltas(t, "s1").length).toBeGreaterThan(30); // the stream really did keep running
    expect(reveals(t, "s1")).toHaveLength(1);
    hub.dispose();
  });

  test("any player counts — one who found it and dropped in the same breath still found it", () => {
    const { t, hub, clock, exit } = match(2);
    walkTo(hub, "s2", offDoor(exit, 500));
    hub.handleClose("s2"); // their socket goes before the tick that would have noticed
    clock.advance(TICK);
    expect(reveals(t, "s1").map((d) => d.exitRevealed)).toEqual([true]);
    hub.dispose();
  });

  test("the finder's death does not take the door back", () => {
    const { t, hub, clock, exit, code } = match(2);
    walkTo(hub, "s2", offDoor(exit, 200));
    clock.advance(TICK);
    hub.handleMessage("s2", JSON.stringify({ type: "game/health", hp: 0, seq: 1 }));
    clock.advance(TICK * 10);
    expect(reveals(t, "s1")).toHaveLength(1); // still exactly the one, and never a retraction
    hub.handleMessage("s9", JSON.stringify({ type: "lobby/join", code, name: "Late" }));
    expect(keyframeFor(t, "s9")?.exitRevealed).toBe(true);
    hub.dispose();
  });

  test("the reconnect keyframe carries it, so the door survives a disconnect", () => {
    const { t, hub, clock, exit, code, tokens } = match(2);
    walkTo(hub, "s2", offDoor(exit, 200));
    clock.advance(TICK);
    hub.handleClose("s2");
    hub.handleMessage(
      "s3",
      JSON.stringify({ type: "lobby/join", code, name: "P2", token: tokens[1] }),
    );
    expect(keyframeFor(t, "s3")?.exitRevealed).toBe(true);
    hub.dispose();
  });

  test("the door outlives the player who found it leaving the match entirely", () => {
    const { t, hub, clock, exit, code } = match(2);
    walkTo(hub, "s2", offDoor(exit, 200));
    clock.advance(TICK);
    hub.handleMessage("s2", JSON.stringify({ type: "lobby/leave" })); // position deleted with them
    clock.advance(TICK * 10);
    hub.handleMessage("s9", JSON.stringify({ type: "lobby/join", code, name: "Late" }));
    expect(keyframeFor(t, "s9")?.exitRevealed).toBe(true);
    hub.dispose();
  });

  test("a keyframe from a match where nobody has found it says nothing about the door", () => {
    const { t, hub, clock, code } = match(1);
    walkTo(hub, "s1", CENTRE);
    clock.advance(TICK);
    hub.handleMessage("s9", JSON.stringify({ type: "lobby/join", code, name: "Late" }));
    expect(keyframeFor(t, "s9")).toBeDefined();
    expect(keyframeFor(t, "s9")).not.toHaveProperty("exitRevealed");
    hub.dispose();
  });
});
