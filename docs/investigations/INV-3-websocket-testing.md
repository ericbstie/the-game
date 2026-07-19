# INV-3 — WebSocket test harness for the lobby server

GitHub issue #7 · Status: **Resolved** · Date: 2026-07-19

## Question

Can we drive a Bun WebSocket server with multiple in-test clients to assert
**join / leave / roster-broadcast / reconnect**, satisfying the repo's mandatory
TDD? What is the reusable harness — start a server on an ephemeral port, connect
N clients, await specific messages, tear down — without flakiness or hangs?

## Method

Wrote a throwaway spike test
(`scratchpad/inv3/lobby.spike.test.ts`) using only `bun:test` and the global
`WebSocket` client — no new deps (yagni). It stands up a minimal lobby
`Bun.serve` on `port: 0`, tracks connected sockets in a `Set`, and broadcasts a
JSON roster event on `open`/`close`. Three tests drive two clients each and
assert the broadcast a *peer* receives. Ran it from the repo root (so the real
`bunfig.toml` preload applies) and from a directory with no bunfig, 5× each, to
check the WebSocket implementation and flakiness.

## Decision

**Yes — it works, and the pattern below is the confirmed reusable harness.** It
passed 3/3, 5 runs in a row, under both WebSocket implementations (see Evidence).

Three pieces make it reliable:

**1. Ephemeral port.** `Bun.serve({ port: 0, ... })` lets the OS pick a free
port; read it back as `server.port`. Never hard-code a port — parallel test
files would collide.

```ts
const server = Bun.serve<{ name: string }, {}>({
  port: 0,
  fetch(req, srv) {
    const name = new URL(req.url).searchParams.get("name") ?? "anon";
    if (srv.upgrade(req, { data: { name } })) return; // 101 — return nothing
    return new Response("expected websocket", { status: 426 });
  },
  websocket: {
    open(ws)  { clients.add(ws);    broadcast({ type: "player_joined", ... }); },
    close(ws) { clients.delete(ws); broadcast({ type: "player_left",  ... }); },
    message() {},
  },
});
const url = `ws://localhost:${server.port}`;
```

**2. A buffering client that can `waitFor(predicate)`.** The key anti-race move:
attach the `message` listener *once, immediately*, and push every inbound
message into a buffer. `waitFor` scans the buffer first (the message may have
already arrived), and only then parks a waiter — with a `setTimeout` reject so a
missed message **fails fast instead of hanging the suite**. A `predicate`
(not "next message") lets a client ignore unrelated traffic (e.g. its own
`welcome`) and match the one event it cares about.

```ts
function makeClient(url: string, name: string) {
  const ws = new WebSocket(`${url}?name=${name}`);
  const buffer: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); // deliver to a parked waiter
    else buffer.push(msg);                            // or stash for a future waitFor
  });

  const opened = new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error(`ws error ${name}`)));
  });

  const waitFor = (pred, timeoutMs = 1000) =>
    new Promise<Msg>((resolve, reject) => {
      const i = buffer.findIndex(pred);
      if (i >= 0) return resolve(buffer.splice(i, 1)[0]); // already arrived
      const waiter = { pred, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const j = waiters.indexOf(waiter);
        if (j >= 0) { waiters.splice(j, 1); reject(new Error(`timeout (${name})`)); }
      }, timeoutMs).unref?.();
    });

  const close = () => new Promise<void>((res) => {
    if (ws.readyState === WebSocket.CLOSED) return res();
    ws.addEventListener("close", () => res());
    ws.close();
  });

  return { ws, opened, waitFor, close };
}
```

**3. Deterministic ordering & teardown.**
- Always `await client.opened` before asserting; for two peers,
  `await Promise.all([a.opened, b.opened])`.
- Drain a client's *own* self-events (e.g. its `welcome`, its own
  `player_joined`) or, simpler, make predicates target the *other* player by
  name — `waitFor(m => m.type === "player_joined" && m.name === "A")`.
- Roster is a `Set`, so **sort before comparing**:
  `expect(roster.sort()).toEqual(["A", "B"])` — Set iteration order is not a
  contract to test against.
- Teardown: `server.stop(true)` in `afterEach`. The `true` (force) closes
  lingering sockets so ports/handles don't leak between tests.
- **Reconnect** needs no server support: close the socket, `await` the peer's
  `player_left`, then construct a *fresh* `WebSocket` and await the peer's next
  `player_joined`. A "reconnect" is just a new connection with the same name.

## Evidence

Environment: `bun 1.3.11 (af24e281)`, `bun test` same. Deps had to be installed
first (`bun install` — `node_modules` was absent; `package.json`/`bun.lock`
untouched).

Spike run from the repo root (real `bunfig.toml` preload = happy-dom active):

```
bun test v1.3.11 (af24e281)

scratchpad/inv3/lobby.spike.test.ts:
[bun] Warning: ws.WebSocket 'upgrade' event is not implemented in bun

 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file. [231.00ms]
```

Tests: (1) peer B receives `player_joined` when A joins; (2) B receives
`player_left` when A leaves; (3) reconnect — a fresh socket for A rejoins and B
sees it. Stable **5/5 consecutive runs**. Existing `src/App.test.tsx` still
passes (1 pass) — unaffected.

### Gotcha: which `WebSocket` is global depends on the preload

`bunfig.toml` preloads `test/setup.ts`, which calls happy-dom's
`GlobalRegistrator.register()`. That **replaces `globalThis.WebSocket`** with
happy-dom's `ws`-backed class (`class WebSocket extends WebSocketImplementation`).
It works against `Bun.serve` but prints a harmless, unavoidable stderr line:
`[bun] Warning: ws.WebSocket 'upgrade' event is not implemented in bun`. Running
the same file from a directory with no bunfig uses **Bun's native** WebSocket —
no warning, faster (~20 ms vs ~230 ms). The harness is implementation-agnostic
and passed 3/3 under both. Downstream lobby tests will run under the happy-dom
preload, so expect that warning; it is not a failure and needs no workaround.

## Residual unknowns / follow-ups

- **Auth / identity.** Spike passes the player name via query string. Real lobby
  join likely needs a token/handshake message; not exercised here.
- **Backpressure / large rosters.** `ws.send` return value (buffered vs sent)
  and behavior with many clients not tested — fine for small co-op squads.
- **True reconnect semantics.** Spike models reconnect as a brand-new socket. If
  the lobby needs session resumption (same seat, preserved state across a drop),
  that server-side logic is out of scope and untested.
- **Abrupt drops.** Only graceful `ws.close()` was exercised; a killed process /
  half-open socket path (and any server-side timeout to detect it) is untested.
- **Real server shape.** INV-1's premise (one `Bun.serve` with `fetch` +
  `websocket`) held for the spike. The production `server.ts` currently only
  serves `index.html` via `routes` — the `websocket` handler still needs adding.

## Status

**Resolved.** The harness pattern is proven and reusable; TDD for join / leave /
roster-broadcast / reconnect is unblocked. Spike lives at
`scratchpad/inv3/lobby.spike.test.ts` (throwaway — lift the `startLobby` and
`makeClient` helpers into the real lobby test file when INV work lands).
