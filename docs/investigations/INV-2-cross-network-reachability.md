# INV-2 — Cross-network reachability (issue #6)

How do two players on **different networks** reach the same lobby with the
standalone-Bun-executable model? Is **WSS/TLS** required for browser WebSockets,
and what is the minimal way to *demonstrate* "different networks" for Milestone #1?

## Question

Given the shipped artifact is a single compiled Bun server (INV-1 premise: one
process serves the client and accepts **same-origin** WS upgrades via
`Bun.serve({ fetch, websocket })`):

1. What public host/port must the server expose, and does the browser force
   `wss://` (TLS) rather than `ws://`?
2. What is the minimal reproducible demo of two devices on different networks in
   the same lobby for M1?

## Method

- Read primary specs for the browser mixed-content / secure-context rules that
  govern `ws://` vs `wss://` (W3C Secure Contexts, W3C Mixed Content, MDN).
- Read Bun's server docs for interface binding (`hostname`), `PORT` handling,
  and native TLS.
- Compared tunnel/deploy options (cloudflared quick tunnel, ngrok, bore, VPS).
- Ran a single-container spike proving `Bun.serve` accepts a WebSocket beyond
  loopback: server bound to `0.0.0.0`, client dialed the container's
  **non-loopback** IPv4 (not `localhost`), full send/echo round-trip.
- Sandbox limit: one container, so a genuine second network was **not**
  exercised. The spike is the closest real proof available here.

## Decision

**M1 demo bar: a real public deploy is NOT required.** The definition-of-done is
two devices on **genuinely different networks** joining one lobby through a
single ephemeral **HTTPS tunnel URL**. No VPS, no cert management, no cost.

**Recommended mechanism — cloudflared quick tunnel in front of the local
compiled server:**

```sh
PORT=3000 ./breakout-box          # compiled Bun executable, binds 0.0.0.0:3000, speaks plain http/ws
cloudflared tunnel --url http://localhost:3000   # prints https://<random>.trycloudflare.com
```

Both players open the same `https://<random>.trycloudflare.com`. One on home
Wi-Fi, one on cellular = two different networks, verifiably.

**Why this shape:**

- **The browser forces `wss://` on an HTTPS page.** Secure Contexts §3.1 step 3:
  *"If origin's scheme is either `https` or `wss`, return Potentially
  Trustworthy."* `ws://` and `http://` are not potentially trustworthy, so under
  Mixed Content (*"an a priori authenticated URL is equivalent to a potentially
  trustworthy URL"*) a `ws://` upgrade from an `https://` page is **blockable
  mixed content and is blocked**. MDN corroborates: `new WebSocket("https://…")`
  normalizes its `.url` to `wss://…`. So a publicly-served game page must be
  HTTPS and must therefore open `wss://`.
- **The tunnel supplies that TLS at its edge, so the Bun binary stays plain.**
  Cloudflare terminates HTTPS/WSS at `*.trycloudflare.com` and proxies to the
  local `http://localhost:3000` over plain `ws`. The compiled server needs **no
  cert and no reverse proxy of our own**. Crucially the tunnel **preserves the
  INV-1 same-origin premise**: page and WebSocket are both on the trycloudflare
  host, so `new WebSocket(location.origin…)` still works — no divergence.
- **Bun binds a public interface natively.** `hostname` defaults to `0.0.0.0`
  (all interfaces) and `port` reads `$BUN_PORT`/`$PORT`/`$NODE_PORT` (else 3000),
  so `PORT=3000 ./breakout-box` is publicly bindable with zero code change.
- **Bun can terminate TLS itself** (`tls: { key, cert }`, Bun's own TLS stack —
  no external proxy needed), but that path needs a **CA-signed cert**
  (Let's Encrypt); browsers reject self-signed for `wss://`. That is deploy-time
  ops with no netcode learning, so **defer it past M1**.
- **cloudflared over the alternatives:** ngrok also gives HTTPS+WSS but needs an
  account/authtoken and has connection caps; **bore is raw TCP with no TLS**, so
  it cannot satisfy the browser's `wss://` requirement without us adding a cert —
  wrong tool here. A VPS / Fly / Render gives a stable TLS URL but adds hosting
  cost and setup; keep it for a later "persistent lobby" milestone.

**When a real deploy becomes the bar:** once M1's cross-network netcode is
proven, a stable URL (named cloudflared tunnel, or Fly/Render where the platform
provides edge TLS, or Bun's own `tls` + Let's Encrypt on a VPS) replaces the
ephemeral quick-tunnel URL. Not needed to *demonstrate* different networks.

## Evidence

**Non-loopback WebSocket round-trip (single-container spike).** Server bound to
`0.0.0.0`; client dialed the container's assigned non-loopback IPv4
`192.0.2.2` (not `127.0.0.1`/`localhost`), proving `Bun.serve` accepts
connections off loopback. Spike:
`scratchpad/inv2/non-loopback-proof.ts`. Output:

```
SERVER bound hostname=0.0.0.0 port=41561
SERVER non-loopback dial target = ws://192.0.2.2:41561
CLIENT connected to ws://192.0.2.2:41561 (non-loopback)
CLIENT received: echo:hello-from-different-network-stand-in
RESULT: PASS — non-loopback WebSocket round-trip succeeded
```

**Doc sources:**

- Browser forces `wss://` on secure pages — W3C Secure Contexts §3.1 (scheme
  check): https://www.w3.org/TR/secure-contexts/ ; W3C Mixed Content (a-priori
  authenticated = potentially trustworthy; else blocked):
  https://www.w3.org/TR/mixed-content/ ; MDN WebSocket (`https`→`wss` URL
  normalization): https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket ;
  MDN Mixed content: https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- Bun binding + native TLS (`hostname` default `0.0.0.0`, `PORT` env, `tls`
  option): https://bun.sh/docs/api/http
- cloudflared quick tunnel (no account, random ephemeral `*.trycloudflare.com`,
  edge TLS, dev/test only):
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
- ngrok (HTTPS+WSS auto, random URL, needs authtoken):
  https://ngrok.com/docs/universal-gateway/http/
- bore (raw TCP, no TLS): https://github.com/ekzhang/bore

## Residual unknowns / follow-ups

- **True cross-network is UNVERIFIED.** One container can't provide a second
  network; the spike only proves off-loopback binding on one host. **Verify
  later** by running the quick-tunnel command and opening the printed URL from a
  phone on cellular (different ASN) while a laptop is on Wi-Fi — confirm both
  land in one lobby.
- **Quick-tunnel WebSocket longevity unverified.** Cloudflare edge idle behavior
  vs Bun's default `idleTimeout` (10s) is untested for a live match; may need
  `websocket.sendPings`/raised `idleTimeout`. Confirm during the M1 demo.
- **Ephemeral URL rotates per run** — fine for a one-shot demo, unusable as a
  persistent lobby address. A stable URL needs a named tunnel/account or a real
  deploy (later milestone).
- **trycloudflare reliability / rate limits** for a full session are unknown; keep
  ngrok as a fallback. Note quick tunnels don't support SSE (irrelevant — we use
  WebSockets, which are supported).

## Status

**Decided.** M1 DoD demo bar = local compiled server bound to `0.0.0.0` +
cloudflared quick tunnel, two devices on different networks in one lobby; real
public deploy deferred. Off-loopback binding proven locally; genuine
cross-network left as the M1 acceptance test above.
