# Cross-network lobby demo (cloudflared quick tunnel)

Milestone 1's definition-of-done is two devices on **genuinely different networks**
(e.g. a laptop on Wi-Fi and a phone on cellular) sharing one lobby. The shipped
artifact is a single compiled Bun server; a free [cloudflared] quick tunnel puts it on
the public internet with edge TLS — no account, no cert, no cost (INV-2).

## Why a tunnel

A publicly-served page is HTTPS, and browsers **force `wss://` on an HTTPS page**
(a `ws://` upgrade from `https://` is blocked mixed content). The compiled server
speaks plain `http`/`ws`; the tunnel terminates HTTPS/WSS at its edge and proxies to
the local server. Because the page and its WebSocket are both on the
`*.trycloudflare.com` host, the client's same-origin `new WebSocket(...)` still holds
(INV-1) — nothing about the app changes.

## Run it

Requires [Bun] and [cloudflared] (`brew install cloudflared`, or see the docs).

```sh
# 1. Build the standalone server binary
bun run compile                       # -> dist/breakout-box-server

# 2. Run it. Bun binds 0.0.0.0 by default, so it is publicly reachable.
PORT=3000 ./dist/breakout-box-server  # "Breakout Box listening on http://localhost:3000/"

# 3. In a second terminal, expose it. Prints https://<random>.trycloudflare.com
cloudflared tunnel --url http://localhost:3000
```

Open the printed `https://<random>.trycloudflare.com` on both devices. One hosts and
reads out the 4-character lobby code; the other joins with it. The roster updates live
on both, and pulling one device off Wi-Fi (or toggling airplane mode briefly) shows the
disconnect → **Reconnecting…** → reclaim path across the tunnel.

> The quick-tunnel URL is ephemeral — it changes every run. That is fine for a demo; a
> persistent lobby address would need a named tunnel or a real deploy (a later milestone).

## Keepalive

Idle lobby sockets must survive minutes of silence. Cloudflare's edge closes an idle
WebSocket at **~100 s**; Bun's `sendPings` (default **true**) sends ping frames that
cross the tunnel and reset both the edge and the server idle timers. The server sets
**`idleTimeout: 45`** (`src/lobby/server.ts`) — comfortably under the edge's 100 s, so
a healthy idle socket is pinged well before the edge would drop it, while a genuinely
dead socket is detected in ~45 s and enters its grace window. No app-level heartbeat is
needed.

## Residual manual checks

These could not be exercised in the sandbox (one container, no second network) and
should be confirmed on real devices:

- **True cross-network:** host on Wi-Fi, join from a phone on cellular (a different
  network/ASN) via the one tunnel URL — confirm both land in the same lobby.
- **WebSocket longevity:** leave a lobby idle for several minutes through the tunnel and
  confirm no socket drops (validates the `idleTimeout: 45` + `sendPings` keepalive).
- **Dev HMR + app socket:** in `bun --hot server.ts`, confirm the browser's HMR socket
  (`/_bun/*`) and the app's `/ws` coexist while editing a source file.

[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
[Bun]: https://bun.sh
