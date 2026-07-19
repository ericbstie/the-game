// Lobby wire protocol — the transport contract shared by server and client (INV-5).
// A flat envelope discriminated on a slash-namespaced `type`; the whole message
// family is one union so TypeScript narrows each case exactly. Protocol version is
// connection-scoped, negotiated once at the WS upgrade (`/ws?v=1`), never per-frame.

export const PROTOCOL_VERSION = 1;
export const WS_PATH = "/ws";

// The `v` query param carried on the WS upgrade must match exactly; anything else is
// refused before the socket is upgraded.
export function isSupportedVersion(raw: string | null): boolean {
  return raw === String(PROTOCOL_VERSION);
}

export const MAX_PLAYERS = 6;
export const NAME_MAX = 16;

export type LobbyCode = string; // 4 chars, Crockford base32
export type PlayerId = string; // public, server-minted; appears in all broadcast state
export type PlayerToken = string; // secret, client-persisted; authenticates (re)join only

export type Presence =
  | { status: "connected" }
  | { status: "disconnected"; graceExpiresAt: number } // slot held + greyed during grace
  | { status: "gone" }; // slot released

// A roster entry every client can see. Deliberately has no `token` — that omission
// is the security boundary.
export interface PublicPlayer {
  id: PlayerId;
  name: string;
  slot: number; // 1..MAX_PLAYERS
  presence: Presence;
}

// The private identity handed only to its owner. The token lives nowhere else.
export interface Self {
  id: PlayerId;
  token: PlayerToken;
  slot: number;
}

export interface LobbySnapshot {
  code: LobbyCode;
  phase: "lobby" | "in-game";
  maxPlayers: number;
  host: PlayerId;
  players: PublicPlayer[]; // sorted by slot
  rev: number;
}

type Envelope<T extends string, P extends object = Record<never, never>> = { type: T } & P;

// Client -> server commands. The first command on a fresh socket establishes
// identity; later commands are authorized by the connection. Reconnect is just
// `lobby/join` with a known token (reclaim), so there is no separate command.
export type CreateLobby = Envelope<"lobby/create", { name: string; maxPlayers?: number }>;
export type JoinLobby = Envelope<
  "lobby/join",
  { code: LobbyCode; name: string; token?: PlayerToken }
>;
export type LeaveLobby = Envelope<"lobby/leave">;
export type ClientMessage = CreateLobby | JoinLobby | LeaveLobby;

export type LobbyErrorCode = "lobby-not-found" | "lobby-full" | "slot-released" | "invalid";

interface WelcomePayload {
  code: LobbyCode;
  you: Self;
  snapshot: LobbySnapshot;
}

// Server -> client events. The actor (host / joiner / reconnecter) gets a full
// snapshot; the rest of the squad gets small deltas that each carry the resulting
// `rev` for apply-if-newer idempotency.
export type LobbyCreated = Envelope<"lobby/created", WelcomePayload>;
export type LobbyJoined = Envelope<
  "lobby/joined",
  WelcomePayload & { reclaimed: boolean; tookOver: boolean }
>;
export type PlayerJoined = Envelope<"lobby/player-joined", { player: PublicPlayer; rev: number }>;
export type PresenceChanged = Envelope<
  "lobby/presence-changed",
  { id: PlayerId; presence: Presence; rev: number }
>;
export type PlayerLeft = Envelope<
  "lobby/player-left",
  { id: PlayerId; slot: number; reason: "left" | "grace-expired"; rev: number }
>;
export type HostChanged = Envelope<"lobby/host-changed", { host: PlayerId; rev: number }>;
export type Superseded = Envelope<"lobby/superseded">;
export type LobbyError = Envelope<"lobby/error", { code: LobbyErrorCode; message?: string }>;

export type ServerMessage =
  | LobbyCreated
  | LobbyJoined
  | PlayerJoined
  | PresenceChanged
  | PlayerLeft
  | HostChanged
  | Superseded
  | LobbyError;

// Hand-rolled inbound narrowing (no schema dep, per spec). Untrusted client input is
// never assumed valid: every field is checked before the message is trusted.
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const msg = value as Record<string, unknown>;

  switch (msg.type) {
    case "lobby/create": {
      if (!isName(msg.name)) return null;
      if (msg.maxPlayers !== undefined && !isValidMax(msg.maxPlayers)) return null;
      return {
        type: "lobby/create",
        name: msg.name,
        maxPlayers: msg.maxPlayers as number | undefined,
      };
    }
    case "lobby/join": {
      if (typeof msg.code !== "string" || !isName(msg.name)) return null;
      if (msg.token !== undefined && typeof msg.token !== "string") return null;
      return {
        type: "lobby/join",
        code: msg.code,
        name: msg.name,
        token: msg.token as string | undefined,
      };
    }
    case "lobby/leave":
      return { type: "lobby/leave" };
    default:
      return null;
  }
}

// A name is required and a string; bounds/emptiness are resolved server-side
// (empty -> default `Player N`), so the guard only rejects the non-string case.
function isName(value: unknown): value is string {
  return typeof value === "string";
}

function isValidMax(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= MAX_PLAYERS;
}
