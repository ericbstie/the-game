# INV-1 — Single-process serving topology (client + same-origin WebSocket)

GitHub issue: #5 · Type: wayfinder investigation (decision + knowledge, no shipped feature) · Date: 2026-07-19

## Question

What single-process server topology lets **one Bun process** serve the built React app **and** accept **same-origin** WebSocket upgrades, while keeping a fast dev/hot-reload loop?

Specifically: does today's `bun ./index.html` dev flow coexist with a WS server, or should we unify on `Bun.serve({ fetch, websocket })` (with `server.upgrade(req)`) plus a dev static/HMR path? How do dev vs prod (compiled executable) differ?

## Method

- Verified against the **installed** runtime: `bun 1.3.11` (`1.3.11+af24e281e`). All required features exist here (`routes` needs ≥1.2.3, HMR needs ≥1.2.3, AOT fullstack bundling needs ≥1.2.17).
- Read current official Bun docs (see Evidence for URLs).
- Built throwaway spikes in the scratchpad and **actually ran them**: one unified server (HTML + WS + HMR), one HMR-coexistence probe, one production/compiled build. Each spike opens a **same-origin** `WebSocket` (same port) and asserts an echo round-trip.
- No repo files were modified. `server.ts`, `package.json`, `index.html`, and `src/` are untouched; this doc is the only repo change.

## Decision

**Unify on a single `Bun.serve({ routes, fetch, websocket })` in `server.ts`.** One process, one port, one origin serves the bundled React app via HTML-import routes and upgrades same-origin WebSockets in the `fetch` handler via `server.upgrade(req)`. This works identically in dev (with HMR) and in the compiled standalone binary.

**`bun ./index.html` cannot host a WebSocket server.** It is a code-less zero-config CLI shortcut for the fullstack dev server — there is no seam to attach `fetch`, `server.upgrade`, or a `websocket` handler. Therefore **dev must also route through the server file**, not the bare HTML entrypoint. This is the one concrete change from today's `dev` script.

The existing `server.ts` is already ~90% there — it imports `./index.html` and serves it via `routes: { "/": index }`. It needs only: a `fetch` fallback that upgrades `/ws`, a `websocket` handler, and an env-gated `development` field.

### Same-origin mechanic

HTTP and WS share the exact same `Bun.serve` listener/port. A route miss falls through to `fetch`, where `server.upgrade(req)` performs the `101 Switching Protocols`. The browser connects with no CORS and no second port:

```ts
// browser
const ws = new WebSocket(`ws://${location.host}/ws`);
```
```ts
// server.ts (shape)
Bun.serve({
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: { "/": index },              // bundled React app
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: /* identity, INV-4 */ {} })) return; // 101, no Response
      return new Response("upgrade failed", { status: 500 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: { open(ws) {/*…*/}, message(ws, m) {/*…*/}, close(ws) {/*…*/} },
});
```

### HMR coexists with the app WebSocket

Bun's dev HMR uses its **own** WebSocket under `/_bun/*`. Bun intercepts `/_bun/*` **before** the user `fetch`/`websocket` handler, so the HMR socket never reaches (or collides with) the app's `/ws`. Proven below.

### Recommended dev-vs-prod command layout

Recommendation only — do not treat as an applied change (package.json untouched).

| Purpose | Command | `development` | What you get |
|---|---|---|---|
| **Dev** | `bun --hot server.ts` | `{ hmr: true, console: true }` | Client HMR (frontend re-bundled per request, browser updates without reload) + server-side hot reload + same-origin WS. One process/port. |
| **Prod (interpreted)** | `NODE_ENV=production bun server.ts` | `false` | Cached + minified bundle, `ETag`/`Cache-Control`, same WS. Lazy bundle on first request. |
| **Prod (shipped artifact)** | `bun build ./server.ts --compile …` → run binary | `false` | Standalone executable with the client manifest **pre-bundled and embedded**; serves HTML + WS with no bundler at runtime. This is the current `compile` script — it keeps working. |

Net change from today: `dev` moves from `bun ./index.html` → `bun --hot server.ts`; `server.ts` gains the `fetch`+`websocket` seams and an env-gated `development`. `serve`/`compile` scripts are unaffected in shape. `index.html` and `src/` are unchanged.

## Evidence

Runtime: `bun 1.3.11+af24e281e`. Spikes in scratchpad (`spike-server.ts`, `spike-hmr-coexist.ts`, `spike-prod-server.ts`); throwaway.

Docs (current live Bun docs, fetched 2026-07-19; not version-pinned, but every feature verified against installed 1.3.11):
- WebSockets / `server.upgrade` / `websocket` handler — https://bun.sh/docs/api/websockets
- `Bun.serve`, `routes`, HTML imports, lifecycle — https://bun.sh/docs/api/http
- Fullstack dev server, HMR, `development` object, dev-vs-prod, `--compile` manifest — https://bun.sh/docs/bundler/fullstack

**1. Unified server — HTML bundling + same-origin WS + HMR, one process** (`bun run spike-server.ts`):
```
SERVER.development=true
Bundled page in 7ms: spike-index.html
HTML_STATUS=200
HTML_CONTENT_TYPE=text/html;charset=utf-8
HTML_HAS_BUNDLED_SCRIPT=true          # <script src="/_bun/client/spike-index-…js" data-bun-dev-server-script>
SERVER: ws open, data= {"path":"/ws"}
CLIENT: received: echo:ping
ECHO_OK=true                          # same-origin WS round-trip on the same port
```
Same result under `bun --hot spike-server.ts` (`Bundled page in 4ms`, `ECHO_OK=true`) — server-side hot reload does not break the topology.

**2. HMR coexistence probe** (`bun run spike-hmr-coexist.ts`):
```
BUN_INTERNAL_PATHS= ["/_bun/client/spike-index-…js","/_bun/unref"]
INTERNAL_REQ_STATUS= 404
USER_FETCH_SAW_INTERNAL= false             # Bun handles /_bun/* before user fetch
USER_WS_HANDLER_SAW_HMR_CONNECT= false     # HMR socket never reaches the app websocket handler
USER_WS_ECHO= echo:hi                      # app /ws still upgrades to the app handler
USER_WS_HANDLER_FIRED_FOR_OUR_WS= true
```

**3. Production + compiled standalone binary** (`development:false`, then `bun build --compile`):
```
# interpreted (development:false)
PROD_HTML_STATUS=200
PROD_HTML_HAS_BUNDLED_SCRIPT=true
PROD_HTML_HAS_DEV_MARKER=false        # minified, no dev client injected
PROD_WS_ECHO=echo:hi

# compiled standalone binary (./spike-prod-bin, no bun runtime in path)
[5ms]  bundle  4 modules
[639ms] compile  spike-prod-bin
PROD_HTML_STATUS=200
PROD_HTML_HAS_BUNDLED_SCRIPT=true
PROD_HTML_HAS_DEV_MARKER=false
PROD_WS_ECHO=echo:hi                  # shipped artifact serves app + same-origin WS
```

## Residual unknowns / follow-ups

- **Real-browser HMR + app-WS coexistence** was proven *structurally* (`/_bun/*` interception) and via a Bun-side WS client, not by driving an actual browser with both sockets live. High confidence; a cheap manual browser check is a good pre-implementation confirmation.
- **`--hot` reload preserving live sockets across an edit** was not exercised (only startup). Bun documents in-place `server.reload` of `fetch`/`websocket`/`routes`; confirm existing WS connections survive a source edit if that matters for dev ergonomics.
- **Route namespacing** (`/ws` vs future `/api/*`) is an open convention choice — coordinate with INV-5 (wire protocol).
- **Upgrade-time identity/auth**: cookies/headers are available on `req.headers` in `fetch` and can be attached via `server.upgrade(req, { data })`. Design deferred to INV-4.
- **Keepalive/timeouts**: WS `idleTimeout` defaults to 120s and `sendPings` defaults true; tune for the game loop during implementation.

## Status

**Decided / resolved.** Recommended topology and dev/prod command layout above; verified on the installed Bun 1.3.11 across dev-HMR, production-interpreted, and compiled-standalone paths. Ready for `/to-spec`.
