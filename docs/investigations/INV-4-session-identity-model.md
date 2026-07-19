# INV-4 — Session, identity & reconnect model

**Issue:** #8 · **Type:** wayfinder investigation (decision + domain model, not a shipped feature)
**Milestone:** #1 (main menu + lobby + multiplayer scaffolding — "lobby code", "handle client disconnect and reconnect")
**Date:** 2026-07-19 · **Status:** Decided (prototype-validated)

## Question

How does the server model a **session** (code → lobby → player slots)? How is a
player's **identity** established and carried across a disconnect so a reconnecting
client **reclaims its slot**? What **grace/timeout** governs a held slot, and what
happens to the slot meanwhile?

## Method

- Took INV-1's premise as given: one origin, `Bun.serve({ fetch, websocket })`,
  server-authoritative lobby state.
- Applied the `domain-modeling` skill — named concepts in the game's own language
  (DESIGN.md: *squad*, *session*, *host*, *lobby*), and `yagni` — no new deps, Bun
  built-ins only, `crypto.randomUUID()` for ids.
- Dispatched a Haiku research subagent to confirm reuse-first primitives (see
  Evidence): `crypto.getRandomValues` for codes, Web Crypto `randomUUID`, plain
  `Map` + `setTimeout` for a TTL/grace, Bun `ServerWebSocket` lifecycle
  (`open/message/close/drain`, `ws.data`, `idleTimeout`).
- Built a throwaway pure (no-network) session store with an injectable clock and
  proved the policy with `bun test`. Prototype lives in scratchpad; it is not
  shipped.

## Decision

### Domain model (named entities)

The shared game instance is a **Session**, addressed by a **LobbyCode**. It seats a
**Squad** of up to 6 **Players**, each in a fixed **slot** (seat). A Player's live
connection is described by its **Presence**.

```ts
type LobbyCode  = string; // 4 chars, Crockford base32 (below)
type PlayerId   = string; // public, server-minted crypto.randomUUID(); in all broadcast state
type PlayerToken= string; // SECRET, client-persisted; authenticates (re)join only, never broadcast

type Presence =
  | { status: "connected" }
  | { status: "disconnected"; graceExpiresAt: number } // slot HELD & greyed during grace
  | { status: "gone" };                                 // slot RELEASED

interface Player {
  id: PlayerId;
  token: PlayerToken;
  name: string;
  slot: number;        // 0..maxPlayers-1; STABLE across a disconnect — the reclaim anchor
  presence: Presence;
}

interface Session {
  code: LobbyCode;
  maxPlayers: number;  // 2..6 (DESIGN: a squad of 2-6)
  phase: "lobby" | "in-game";
  host: PlayerId;
  createdAt: number;
  players: Map<PlayerId, Player>;
}
```

The two-id split is deliberate: **`PlayerId`** is the *public* handle other clients
see; **`PlayerToken`** is the *secret* bearer credential that proves slot ownership.
They must never be the same value.

### LobbyCode format

- **4 characters, Crockford base32** alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
  (drops **I, L, O, U** → no ambiguous glyphs; `0`/`1` stay unambiguous because their
  look-alikes are absent).
- Space = 32⁴ ≈ **1.05M** codes — trivial to read aloud/type, ample for a small game.
- Generated with `crypto.getRandomValues(new Uint8Array(4))`, `byte & 31` (unbiased,
  256 % 32 == 0).
- **Collision handling:** server regenerates on any in-use code (rejection sampling).
  Codes are case-insensitive on input and normalise look-alikes (`O→0`, `I/L→1`).
- Headroom: bump to 5 chars (≈34M) if concurrent-lobby counts ever rise.

### Reconnect policy

- **Identity token — client-persisted, server-generated.** On first join the server
  mints `token = crypto.randomUUID()` and returns it once; the client persists it in
  `localStorage` keyed by lobby code and presents `{ code, token }` on every
  (re)join. Persisting client-side is what survives a reload/refresh; generating
  server-side guarantees entropy, uniqueness, and unguessability.
  - *Trade-off vs pure client-generated token:* a client-generated UUID saves nothing
    here (the client must persist it either way) and lets a buggy/hostile client pick
    a weak or colliding token. 122 bits of v4 entropy make either safe for a casual
    co-op game, so we take the strictly-safer server-generated variant.
- **Grace window: 45 s (default, per-session tunable).** Long enough to ride out a
  page reload, a Wi-Fi blip, or a phone network handoff (typically < 20 s); short
  enough that a held seat isn't dead weight for a whole ~2-minute match. Detection is
  immediate via the WebSocket `close` handler — the grace timer is separate from
  Bun's `idleTimeout` (120 s default, used only as a dead-socket backstop).
- **Slot behaviour during grace: HELD and greyed.** The seat stays occupied (counts
  toward `maxPlayers`), shown as "reconnecting…"; it is **not** re-fillable by another
  joiner until grace expires. This protects squad integrity ("everyone must reach the
  door"). When `graceExpiresAt` passes, the Player is pruned → slot **released** →
  reclaimable by a fresh joiner. Prod arms a `setTimeout(graceMs)` on `close`; the
  prototype prunes lazily on access plus an explicit `sweep()`.
- **Duplicate / hijack:**
  - Reconnect with a token whose slot is *still connected* (second tab/device) →
    **takeover**: newest socket owns the slot, server closes the stale socket
    (e.g. code 4000). A late `close` from the superseded socket must **not** start
    grace on the slot the new socket now owns (guard by current-socket epoch).
  - Unknown/guessed token joining a **full** lobby → **rejected** (`lobby-full`).
  - Unknown/expired token reconnecting → **rejected** (`slot-released`) → must rejoin
    as a new player. The only security boundary is token secrecy + entropy.

### Store surface (prototype)

`createLobby(hostName)`, `join(code, token?)`, `disconnect(token)`,
`reconnect(code, token)`, plus `getSession`/`sweep`. `join` with a *known* token
reclaims; with an *unknown* token it seats a new player (or rejects if full).

## Evidence

`bun test` on the pure store — all green (8 tests):

```
bun test v1.3.11 (af24e281)
 8 pass
 0 fail
 1018 expect() calls
Ran 8 tests across 1 file. [16.00ms]
```

Tests proving the policy:

- **Reclaim within grace** → same slot, presence back to `connected`.
- **Held slot not re-fillable during grace** → intruder join returns `lobby-full`.
- **After grace** → reconnect rejected `slot-released`; a fresh joiner takes the freed
  seat.
- **Unknown token + full lobby** → `lobby-full` (hijack rejected).
- **Unknown token reconnect** → `slot-released`.
- **Reconnect while connected** → `tookOver: true`, same slot.
- **LobbyCode** → 4 chars, unambiguous alphabet (500 samples); input normalisation.

Prototype (throwaway, not shipped):
`scratchpad/inv4/session-store.ts` + `session-store.test.ts`.

## Residual unknowns / follow-ups

- **Grace by phase.** One 45 s default for now. Lobby (no clock) could be more
  generous than in-game (match clock running). Confirm once the match loop exists.
- **In-game avatar during grace.** What happens to a disconnected player's *entity*
  (frozen/invulnerable, or removed and respawn-at-center on return) is a gameplay
  decision, separate from this session model. Owns → a combat/respawn ticket.
- **Host migration.** If the host's slot is released, who becomes `host`? Likely
  lowest-slot connected player. Out of scope for INV-4; flag for lobby-flow ticket.
- **Empty-session lifetime.** When all slots release, how long before the Session
  (and its LobbyCode) is reaped? Needs a session-level TTL decision.
- **Transport of the token.** Confirm the join/reconnect handshake shape over the
  WebSocket upgrade (`server.upgrade(req, { data })` carrying `{ code, token }`) — an
  INV on the message protocol.
- **Rate-limiting.** Guessing 4-char codes / tokens is infeasible at UUID entropy, but
  join attempts should still be rate-limited to prevent lobby-scan abuse.

## Status

**Decided.** Named model (Session / LobbyCode / Player + Presence lifecycle) and
reconnect policy (client-persisted server-generated token, 45 s grace, slot held-then-
released, takeover on duplicate) are validated by a passing prototype. Ready to inform
the Milestone-#1 lobby scaffolding tickets. No `src/` changes made.
