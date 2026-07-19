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

// A player's in-world circle, keyed by the stable PlayerId so it survives reconnect. `hp` is a
// render hint (a peer at 0 HP draws as a corpse); it is not authoritative here.
export interface Avatar {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2;
  radius: number;
  hp: number;
}

// The escape door: a rectangle flush on a perimeter wall.
export interface Exit {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A player's starting placement, streamed once in world-init so every client seeds the
// same roster of Avatars locally. Radius is a constant, so it is not on the wire.
export interface Spawn {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2;
}

// The immutable shared world the server generates once at match start and re-sends on
// reconnect: the arena, the placed exit, and every player's spawn. Avatar motion is not here
// (it flows as peer positions), and the enemy/nest layout is derived from the arena.
export interface WorldInit {
  arena: Arena;
  exit: Exit;
  spawns: Spawn[];
}

// --- Dynamic enemies & combat (Milestone 3) ---
// The server owns all enemy state; the client only renders it. Enemy motion, spawns, and
// deaths stream as `game/map-delta` on the same INV-5 envelope at ~20 Hz.

export type EnemyKind = "grunt" | "elite";

// A newly-spawned enemy, announced once so the client can create its render record (kind +
// hp) before per-tick position deltas start flowing for it. `sector` is the 45° wedge it was
// spawned into (0..7), inherited from its nest.
export interface EnemySpawn {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  hp: number;
  sector: number;
}

// A nest's changed state this tick: its HP and whether it is still alive (spawning). Positions
// are static and derived from the arena, so they never ride the delta.
export interface NestDelta {
  id: string;
  hp: number;
  alive: boolean;
}

// The wave clock's state when a wave fires: the wave index (1-based) and ms until the next.
export interface WaveDelta {
  index: number;
  clockMs: number;
}

// One enemy's position this tick: [id, x, y]. Every live enemy appears in every delta's
// `moves`, so a client that missed a spawn still can't render an unknown id (guarded).
export type EnemyMove = [id: string, x: number, y: number];

// An enemy's HP after taking damage this tick. The client updates its stored hp; deaths
// (hp reached 0) ride the separate `deaths` array instead.
export interface EnemyHit {
  id: string;
  hp: number;
}

// The per-tick enemy/combat delta: a full `moves` set plus sparse event arrays — only the
// non-empty ones ride the wire. `tick` is monotonic per session; the client applies-if-newer.
export interface MapDelta {
  tick: number;
  moves: EnemyMove[];
  spawns?: EnemySpawn[];
  hits?: EnemyHit[];
  deaths?: string[];
  nests?: NestDelta[];
  wave?: WaveDelta;
}

// A player weapon. Melee is a close cleave wedge; ranged is a hitscan ray (added in #41).
// Every player has both in M3's minimal model.
export type Weapon = "melee" | "ranged";

// A render-model enemy the client assembles each frame (not a wire type). Its position is
// interpolated a short delay behind the stream, exactly like a peer avatar.
export interface RenderedEnemy {
  id: string;
  kind: EnemyKind;
  pos: Vec2;
  radius: number;
  hp: number;
}

// A render-model nest (not a wire type). Position/sector are static (derived from the arena);
// hp/alive track the streamed nest state.
export interface RenderedNest {
  id: string;
  pos: Vec2;
  radius: number;
  hp: number;
  alive: boolean;
  sector: number;
}

// The render model the client assembles each frame from world-init + local self-sim +
// relayed peer positions + the enemy stream. Not a wire type — it never crosses the socket.
export interface WorldSnapshot {
  arena: Arena;
  players: Avatar[]; // sorted by slot
  enemies: RenderedEnemy[];
  nests: RenderedNest[];
  exit: Exit;
}

// The movement intent driving the client's own Avatar: which directions are held. The
// client integrates this locally each frame — it never crosses the wire (the client
// owns its position; the server only relays the result).
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
// World commands (M2). `game/start` is host-only (enforced server-side); `game/pos`
// streams the client's own integrated position (the client owns its coordinates —
// the server relays them, never re-simulates them). `seq` is monotonic per player so a
// stale/out-of-order frame is dropped.
export type StartGame = Envelope<"game/start">;
export type GamePos = Envelope<"game/pos", { pos: Vec2; seq: number }>;
// A reported player attack (M3): the client swings/fires and reports it; the server validates
// (cadence + loose range + seq) and applies the damage — enemy HP is never client-writable.
// `pos` is the swing origin (the player's own position); `dir` is a unit aim vector.
export type GameAttack = Envelope<
  "game/attack",
  { weapon: Weapon; pos: Vec2; dir: Vec2; seq: number }
>;
// The client owns its HP (it judges contact damage at its own true position) and reports the
// result; `hp <= 0` declares death. The server never computes it — it stores and relays it.
export type GameHealth = Envelope<"game/health", { hp: number; seq: number }>;
export type ClientMessage =
  | CreateLobby
  | JoinLobby
  | LeaveLobby
  | StartGame
  | GamePos
  | GameAttack
  | GameHealth;

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

// The world stream (M2). On start (and on reconnect) the server sends `game/world-init`
// once; thereafter it relays each client's `game/pos` to the others as `game/peer-pos`.
// `game/map-delta` is reserved for M3 dynamic-map mutations — declared here but never
// emitted in M2.
export type GameWorldInit = Envelope<"game/world-init", { init: WorldInit }>;
export type GamePeerPos = Envelope<"game/peer-pos", { id: PlayerId; pos: Vec2; seq: number }>;
// The dynamic enemy/combat stream (M3): a full-`moves` + sparse-events delta each tick.
export type GameMapDelta = Envelope<"game/map-delta", MapDelta>;
// A player's relayed HP (M3): the server fans out each client's reported health to the squad.
export type GamePeerHealth = Envelope<
  "game/peer-health",
  { id: PlayerId; hp: number; seq: number }
>;

export type ServerMessage =
  | LobbyCreated
  | LobbyJoined
  | PlayerJoined
  | PresenceChanged
  | PlayerLeft
  | HostChanged
  | Superseded
  | LobbyError
  | GameWorldInit
  | GamePeerPos
  | GameMapDelta
  | GamePeerHealth;

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
    case "game/pos": {
      const pos = asVec2(msg.pos);
      if (pos === null || !isFiniteNumber(msg.seq)) return null;
      return { type: "game/pos", pos, seq: msg.seq };
    }
    case "game/attack": {
      const pos = asVec2(msg.pos);
      const dir = asVec2(msg.dir);
      if (pos === null || dir === null || !isWeapon(msg.weapon) || !isFiniteNumber(msg.seq)) {
        return null;
      }
      return { type: "game/attack", weapon: msg.weapon, pos, dir, seq: msg.seq };
    }
    case "game/health": {
      if (!isFiniteNumber(msg.hp) || !isFiniteNumber(msg.seq)) return null;
      return { type: "game/health", hp: msg.hp, seq: msg.seq };
    }
    default:
      return null;
  }
}

function isWeapon(value: unknown): value is Weapon {
  return value === "melee" || value === "ranged";
}

// A streamed position must be a Vec2 of finite numbers — a client could send anything,
// so NaN/Infinity/strings/missing keys are rejected before the coordinate is trusted.
function asVec2(value: unknown): Vec2 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  return { x: v.x, y: v.y };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A name is required and a string; bounds/emptiness are resolved server-side
// (empty -> default `Player N`), so the guard only rejects the non-string case.
function isName(value: unknown): value is string {
  return typeof value === "string";
}

function isValidMax(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= MAX_PLAYERS;
}
