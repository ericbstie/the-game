# INV-5 — Lobby message protocol (envelope + event set)

**Issue:** #9 · **Type:** wayfinder investigation (decision + shared wire types, not a shipped feature)
**Milestone:** #1 (lobby + multiplayer scaffolding), forward-looking to #2 (world-state streaming)
**Date:** 2026-07-19 · **Status:** Decided (prototype-validated)

## Question

What is the message **envelope + event set** for the lobby — client→server commands
and server→client events — is it **full-snapshot or deltas**, and how does the
protocol extend cleanly into Milestone #2's world-state streaming?

## Method

- Took the prior premises as given: one `Bun.serve({ routes, fetch, websocket })`
  on a single origin with a same-origin WS (INV-1); lobby messages are **JSON over
  WS**, tests await specific message types (INV-3); the **Session / LobbyCode /
  Squad / Player / slot / PlayerId / PlayerToken / Presence** domain model and the
  reconnect policy (server-minted client-persisted token, 45 s grace, slot
  held-then-released, takeover on duplicate token) from INV-4.
- Applied `yagni` (no new deps; no `zod`; the minimum message set that is fully
  correct) and `domain-modeling` (reuse INV-4's names verbatim on the wire).
- Wrote a **types-only** shared module plus a round-trip/narrowing sample in the
  scratchpad, then validated with strict `tsc --noEmit` and a `bun run` that
  pushes each message through `JSON.stringify`/`parse` and narrows on `type`.
  Prototype (throwaway, not shipped):
  `scratchpad/inv5/protocol.ts`, `roundtrip.ts`, `tsconfig.json`.

## Decision

### Envelope — one discriminated union on a namespaced `type`

Every message is a **flat object discriminated on `type`**, with payload fields
inlined (matches INV-3's `m.type === "…" && m.name === "A"` test style). `type` is
**slash-namespaced** (`lobby/…`, later `world/…`) so a single union spans every
message family and TypeScript narrows each case exactly.

```ts
type Envelope<T extends string, P extends object = {}> = { type: T } & P;
```

**Protocol version is connection-scoped, not per-message.** It is negotiated once
at the WS upgrade — `ws://<host>/ws?v=1` — and validated in `fetch` before
`server.upgrade`; an unsupported version is refused (`invalid`) so no
wrong-dialect socket reaches the handler. This keeps the envelope minimal, gives
one rejection point, and avoids per-frame version bytes on M2's 60 Hz stream.
`PROTOCOL_VERSION = 1`. **Bump only on a breaking change to an existing message;
new `type`s are added additively** (a peer may ignore unknown `type`s), so
introducing the whole `world/*` family later needs no version bump.

### Client → server commands

Sent as JSON over the WS. The **first command on a fresh socket establishes
identity**; the server stashes `{ id, token, code }` in `ws.data` (INV-1/INV-4) so
later commands are authorized **by the connection** — `leave` carries no token.
**Reconnect is just `lobby/join` with a known `token`** (reclaim), so there is no
separate reconnect command (mirrors INV-4's `join(code, token?)` store surface).

```ts
type CreateLobby = Envelope<"lobby/create", { name: string; maxPlayers?: number }>;
type JoinLobby   = Envelope<"lobby/join",   { code: LobbyCode; name: string; token?: PlayerToken }>;
type LeaveLobby  = Envelope<"lobby/leave">;
type ClientMessage = CreateLobby | JoinLobby | LeaveLobby;
```

**No heartbeat command (yagni).** WS-protocol pings + `idleTimeout` (120 s
backstop) and the immediate `close` handler already cover liveness (INV-4); an
app-level heartbeat would be dead weight. RTT/clock-sync belongs to M2 (`world/ping`).

### Server → client events

```ts
type LobbyErrorCode = "lobby-not-found" | "lobby-full" | "slot-released" | "invalid";

interface WelcomePayload { code: LobbyCode; you: Self; snapshot: LobbySnapshot }

// full snapshot + your private identity (the one message that renders the lobby from nothing)
type LobbyCreated = Envelope<"lobby/created", WelcomePayload>;
type LobbyJoined  = Envelope<"lobby/joined",  WelcomePayload & { reclaimed: boolean; tookOver: boolean }>;

// deltas broadcast to the REST of the squad — each carries the resulting rev (== prev + 1)
type PlayerJoined    = Envelope<"lobby/player-joined",    { player: PublicPlayer; rev: number }>;
type PresenceChanged = Envelope<"lobby/presence-changed", { id: PlayerId; presence: Presence; rev: number }>; // disconnect AND reconnect
type PlayerLeft      = Envelope<"lobby/player-left",      { id: PlayerId; slot: number; reason: "left" | "grace-expired"; rev: number }>; // slot released
type HostChanged     = Envelope<"lobby/host-changed",     { host: PlayerId; rev: number }>;

// targeted to the SUPERSEDED socket on a duplicate-token takeover, then server closes it (code 4000)
type Superseded = Envelope<"lobby/superseded">;
// carries an INV-4 error code; sent to the offending client, not broadcast
type LobbyError = Envelope<"lobby/error", { code: LobbyErrorCode; message?: string }>;

type ServerMessage =
  | LobbyCreated | LobbyJoined
  | PlayerJoined | PresenceChanged | PlayerLeft | HostChanged
  | Superseded | LobbyError;
```

Supporting shapes (INV-4 names reused verbatim; **`PublicPlayer` deliberately has
no `token`** — that omission is the security boundary):

```ts
type LobbyCode = string;  type PlayerId = string;  type PlayerToken = string;
type Presence =
  | { status: "connected" }
  | { status: "disconnected"; graceExpiresAt: number } // slot held+greyed during 45 s grace
  | { status: "gone" };
interface PublicPlayer  { id: PlayerId; name: string; slot: number; presence: Presence }
interface Self          { id: PlayerId; token: PlayerToken; slot: number } // token lives ONLY here, to its owner
interface LobbySnapshot { code: LobbyCode; phase: "lobby" | "in-game"; maxPlayers: number;
                          host: PlayerId; players: PublicPlayer[]; rev: number } // players sorted by slot
```

**Event → INV-4 lifecycle mapping:** join → `lobby/player-joined`; disconnect &
reconnect → `lobby/presence-changed` (the `Presence` union encodes both, incl.
`graceExpiresAt`); leave & grace-expiry → `lobby/player-left` (slot released,
distinguished by `reason`); duplicate-token takeover → `lobby/superseded` to the
old socket (+ `tookOver: true` in the new socket's `lobby/joined`); host's slot
releasing → `lobby/host-changed`.

### Snapshot vs delta — **snapshot to the actor, small deltas to the rest**

The lobby is tiny (≤ 6 players), so favor the simplest correct option:

- The **joiner/host/reconnecter** gets a **full `LobbySnapshot`** inside
  `lobby/created` / `lobby/joined` — one message renders the whole lobby from
  nothing, and on reconnect it re-establishes ground truth (a fresh baseline).
- **Everyone else** gets a **small self-contained delta** per discrete change.
  A full re-snapshot on every change would also be correct and even simpler, but
  deltas keep the broadcast readable **and set the exact pattern M2 needs** — M2
  cannot snapshot at 60 Hz, so establishing snapshot-baseline + deltas now means
  M2 changes frequency, not shape.

**Ordering & idempotency.** A WebSocket is one ordered, reliable TCP stream, so
within a connection there is **no reordering and no per-message sequence number is
needed**. A monotonic **`rev`** on the session is the resync seam: snapshots and
deltas both carry it (`delta.rev == prev + 1`); a client applies a delta only if
it advances `rev` (apply-if-newer ⇒ **idempotent**), and a reconnect always yields
a fresh snapshot that resets the baseline, so any deltas buffered before the drop
are superseded. Commands are idempotent where it matters: `leave` twice is a
no-op, `join` with a known token reclaims and returns current state; `create` is a
one-shot user action.

### M2 extensibility — same envelope, `world/` namespace, `rev` → `tick`

M2 world-state reuses the **identical envelope** under a `world/` namespace; the
lobby's snapshot+delta pattern carries over with `rev` generalized to `tick`. At
20–60 Hz the "snapshot only" option is off the table, so `world/snapshot` becomes
a **periodic keyframe** and `world/delta` the **mandatory per-tick diff**. Folding
these into the unions is additive (`ServerMessage | WorldSnapshot | WorldDelta`,
`ClientMessage | WorldInput`) — no `v` bump. One illustrative shape (placeholder,
**not built**):

```ts
type WorldDelta = Envelope<"world/delta",
  { tick: number; spawned: EntityState[]; moved: EntityMove[]; despawned: EntityId[] }>;
```

## Evidence

Environment: `bun 1.3.11`, `tsc 7.0.2`. Prototype in `scratchpad/inv5/`.

Strict `tsc --noEmit` is clean. Its exit 0 **also proves the union narrows**: the
sample contains a `// @ts-expect-error` over `{ type: "lobby/leave", code: … }`;
tsc passing means that directive was *satisfied* (the union really rejected the
wrong-variant field) — an unused directive would have failed the build. The
exhaustive `switch` with a `never` default likewise proves every case is handled.

```
=== TYPECHECK (tsc --noEmit, strict) ===
TSC_EXIT=0 (clean; the @ts-expect-error was satisfied)

=== RUNTIME ROUND-TRIP (bun run) ===
PROTOCOL_VERSION=1
-- server events (post JSON round-trip) --
  created code=7F3K you.slot=0 rev=4
  joined reclaimed=true tookOver=false you.id=p-2
  +player slot=1 rev=5
  presence p-2 -> connected rev=6
  -player p-2 slot=1 (grace-expired) rev=7
  host -> p-2 rev=8
  superseded
  error lobby-full
-- client commands (post JSON round-trip) --
  create name=Ana max=4
  join code=7F3K name=Ben token=known
  leave
-- security: snapshot serialization contains no `token` field: OK
ALL_ROUNDTRIP_ASSERTS_PASSED=true
```

## Residual unknowns / follow-ups

- **Runtime validation.** The wire types are compile-time only; `JSON.parse` is
  `any`. A decoder boundary (hand-written type guards, or `zod` if justified) that
  validates inbound messages before trusting `type`/fields is deferred — record it,
  don't add a dep now (yagni). Untrusted input from clients must not be assumed valid.
- **Error-code reconciliation.** This module uses INV-4's canonical codes
  (`lobby-not-found`, `lobby-full`, `slot-released`, `invalid`); INV-4's prototype
  *store* returned `no-such-lobby`. Reconcile to `lobby-not-found` when the store is
  lifted into `src/`.
- **Versioning mechanics.** Version is negotiated at the WS upgrade query string;
  the exact rejection handshake (close code vs pre-upgrade HTTP status) and any
  future capability negotiation are unspecified.
- **Host-migration policy.** The `lobby/host-changed` event exists; *who* becomes
  host (likely lowest-slot connected player) is an INV-4 follow-up, not settled here.
- **Backpressure.** `ws.send` buffered-vs-sent return and large-broadcast behavior
  untested (fine for ≤ 6 players; revisit for M2's high-frequency stream).
- **M2 shapes.** `EntityState` / `EntityMove` / `WorldInput` are placeholders; a
  dedicated M2 investigation owns entity modeling, tick rate, and interpolation.

## Status

**Decided.** Envelope (discriminated union on a namespaced `type`,
connection-scoped version), the full client/server event set (reusing INV-4 names
and error codes), the snapshot-to-actor + delta-to-rest call with `rev`-based
idempotency, and the additive `world/` extension path are validated by a
strict-`tsc`-clean, round-trip-passing types-only prototype. No `src/`,
`server.ts`, `package.json`, or `index.html` changes made. Ready to inform the
Milestone-#1 lobby protocol tickets.
