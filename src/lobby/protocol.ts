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

// World wire types (Milestone 2). The server owns all of these; the client only
// renders them. They ride the same envelope as the lobby events so world streaming
// is an additive extension, not a second protocol.
export interface Vec2 {
  x: number;
  y: number;
}

export interface Arena {
  width: number;
  height: number;
}

// A player's in-world circle, keyed by the stable PlayerId so it survives reconnect.
export interface Avatar {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2;
  radius: number;
}

// A placeholder enemy shape (static in M2; combat/behaviour is M3).
export interface Monster {
  id: string;
  pos: Vec2;
  radius: number;
}

// The escape door: a rectangle flush on a perimeter wall.
export interface Exit {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldSnapshot {
  arena: Arena;
  players: Avatar[]; // sorted by slot
  monsters: Monster[];
  exit: Exit;
  tick: number; // monotonic; the client applies-if-newer, like the lobby `rev`
}

// The movement intent a client streams: which directions are held. The server derives
// velocity from this so the client never asserts its own position or speed.
export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
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
// World commands (M2). `game/start` is host-only (enforced server-side); `game/input`
// streams the current movement intent.
export type StartGame = Envelope<"game/start">;
export type GameInput = Envelope<"game/input", { move: MoveInput }>;
export type ClientMessage = CreateLobby | JoinLobby | LeaveLobby | StartGame | GameInput;

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

// The world stream (M2): a full WorldSnapshot each server tick.
export type GameState = Envelope<"game/state", { world: WorldSnapshot }>;

export type ServerMessage =
  | LobbyCreated
  | LobbyJoined
  | PlayerJoined
  | PresenceChanged
  | PlayerLeft
  | HostChanged
  | Superseded
  | LobbyError
  | GameState;

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
    case "game/start":
      return { type: "game/start" };
    case "game/input": {
      if (!isMoveInput(msg.move)) return null;
      const m = msg.move as Record<string, boolean>;
      return { type: "game/input", move: { up: m.up, down: m.down, left: m.left, right: m.right } };
    }
    default:
      return null;
  }
}

// A MoveInput must carry exactly the four direction flags, each a real boolean — a
// client could send anything, so integers/strings/missing keys are rejected outright.
function isMoveInput(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.up === "boolean" &&
    typeof m.down === "boolean" &&
    typeof m.left === "boolean" &&
    typeof m.right === "boolean"
  );
}

// A name is required and a string; bounds/emptiness are resolved server-side
// (empty -> default `Player N`), so the guard only rejects the non-string case.
function isName(value: unknown): value is string {
  return typeof value === "string";
}

function isValidMax(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= MAX_PLAYERS;
}
