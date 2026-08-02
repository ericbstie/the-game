import type {
  Arena,
  Avatar,
  Bank,
  BuildableKind,
  EnemyKind,
  EnemySnapshot,
  Exit,
  MapDelta,
  MoveInput,
  NestSnapshot,
  PlayerId,
  Power,
  ProjectileSpawn,
  RenderedEnemy,
  RenderedNest,
  RenderedProjectile,
  StructureSpawn,
  TurretAim,
  Vec2,
  WorldInit,
  WorldSnapshot,
} from "../lobby/protocol";
import {
  type BuildState,
  buildCost,
  freshBuildState,
  generateOre,
  insertStructure,
  metalRate,
  type OreGrid,
  removeStructure,
  slidePos,
} from "./build";
import {
  BLAST_DAMAGE,
  BLAST_RADIUS,
  enemyContactCadenceMs,
  enemyContactDamage,
  enemyRadius,
  NEST_RADIUS,
  type Nest,
  nestLayout,
  PROJECTILE_FLIGHT_MS,
  PROJECTILE_RANGE,
  PROJECTILE_SPEED,
} from "./enemies";
import { freshGait, type Gait, updateFacing } from "./facing";
import { interpolateAt, type PosSample } from "./interpolate";
import { type Body, PLAYER_MAX_HP, PLAYER_RADIUS, pushOutOfBodies, stepPos } from "./world";

// The client's local view of the shared world (Milestone 2 refinement). Built once from
// `game/world-init`, then driven two ways:
//   - The owner's Avatar is integrated locally every frame (`stepSelf`) — instant, never
//     buffered, so input has zero network lag.
//   - Every peer's Avatar is rendered from a short buffer of relayed samples, RENDER_DELAY_MS
//     behind real time (`applyPeer` + `snapshot(now)`), so ~20 Hz updates read as smooth
//     motion instead of a staircase.
// The server no longer simulates avatars — this is where motion lives on the receiving end.

export const RENDER_DELAY_MS = 100; // render peers this far behind real time to smooth the relay
export const BUFFER_MS = 500; // keep this much peer history; older samples are pruned
export const ENEMY_RENDER_DELAY_MS = 50; // enemies render this far behind their 20 Hz stream
// How long a spider stays white after it is hit (#107). Three frames at 60 Hz — enough to register
// — and well under `RANGED_CADENCE_MS`, so consecutive hits read as separate flashes instead
// of one continuous white spider. It lives here rather than in the render layer because the clock it
// is measured against is this class's: the flash has to be judged on the delayed instant the sprite
// is interpolated to, not on the instant the event arrived.
export const HIT_FLASH_MS = 90;
// How long a mark left where a shot connected is kept before it is pruned. A memory bound, and not
// the burst's lifetime — the render layer owns that and passes it to `impactMarks` (#74 §5). It has
// to clear `ENEMY_RENDER_DELAY_MS` on top of any lifetime a caller might ask for, because a mark
// spends that delay waiting for its sprite before it is drawn at all.
export const IMPACT_RETENTION_MS = 250;
// The same memory bound for the marks left where enemies died (#116), and the same rule: it is not
// the puff's lifetime, which the render layer owns and passes to `deathMarks`. It needs no clearance
// for `ENEMY_RENDER_DELAY_MS`, unlike its twin above — a puff spends no time waiting for a sprite,
// because the sprite it replaces is deleted the instant the death arrives.
export const DEATH_RETENTION_MS = 250;
// Dead this long, then the client snaps back to center. With a stopwatch for a score and a base
// to defend, the long walk back from centre is the penalty — at 3 s (M3) dying was free.
export const RESPAWN_DELAY_MS = 20_000;

interface AvatarRecord {
  id: PlayerId;
  slot: number;
  name: string;
  pos: Vec2; // the owner's live local position, or a peer's spawn fallback before any sample
  buffer: PosSample[]; // a peer's arrival-stamped samples (empty for the owner)
  lastSeq: number; // highest applied seq; guards apply-if-newer
  hp: number; // a peer's last relayed HP (render hint); the owner's HP lives in `selfHp`
  healthSeq: number; // highest applied peer-health seq; guards apply-if-newer
  gait: Gait; // 8-way facing + walk frame, derived here from the rendered position
}

// A server-owned enemy the client renders. Its position is buffered and interpolated exactly
// like a peer; kind and hp arrive once via a spawn and update via events. `lastContactAt` is
// the client-local time this enemy last dealt the owner contact damage (per-enemy cadence), and
// `lastHitAt` the client-local time it last took damage itself, which is the whole of the hit
// flash's state.
interface EnemyRecord {
  id: string;
  kind: EnemyKind;
  hp: number;
  pos: Vec2; // spawn fallback until the first move sample buffers
  buffer: PosSample[];
  lastContactAt: number;
  lastHitAt: number;
  gait: Gait; // dies with the record, so a capful of enemies costs nothing to track
}

// A shot in flight as the client holds it (#80): where the server launched it, the heading it is
// travelling on, and the two client-clock instants that bound its life.
//
// **The flight between them is derived, not streamed.** `PROJECTILE_SPEED` is a constant both
// sides compile against, so how far a shot has come is arithmetic on `at` — the same
// derive-don't-stream bet the ore grid and the nest layout already make (ADR 0007).
//
// `endAt` starts at the furthest a shot could possibly still be in the air and is brought forward
// by the `spent` that ends it. Both halves of that matter: the `spent` is what stops a bullet
// flying through the body the server stopped it on, and the initial bound is what stops a lost or
// dropped one hanging in the sky for the rest of the match.
interface ProjectileRecord {
  id: string;
  from: Vec2;
  dir: Vec2;
  at: number;
  endAt: number;
}

// Where something happened to an enemy, and the client instant the delta carrying it arrived. This
// is the whole of the lifecycle a cartoon effect needs, and it is here rather than in `fx.ts` or in
// a module of its own because both halves of it are private to this class: the delta a mark is
// spawned from, and `ENEMY_RENDER_DELAY_MS`, the clock it has to be judged on.
//
// The stamp is arrival and not render time, the same convention `lastHitAt` uses, because the delay
// is applied once — in `impactMarks` — rather than baked into every stamp by every caller.
//
// The position is *frozen*. A mark says where a blow landed, not where the thing that took it has
// got to since, and the two are not the same point: a grunt covers a good part of its own width over
// the life of one. It is also what lets a mark outlive its enemy, which is the case #116 is: a death
// is the tick the record is deleted on, so a puff hung off that record could never be drawn at all.
export interface Mark {
  pos: Vec2;
  at: number;
}

export class ClientWorld {
  readonly arena: Arena;
  readonly ore: OreGrid; // derived from the world's seed, byte-identical to the server's copy
  private readonly exit: Exit;
  private readonly nests: Nest[]; // layout derived from the world's seed; hp/alive track the stream
  private readonly avatars = new Map<PlayerId, AvatarRecord>();
  private readonly enemies = new Map<string, EnemyRecord>();
  // Every shot the server has in the air, the owner's own included (#80). There is no local,
  // optimistic entry in here and no way to make one: `applyMapDelta` is the only writer.
  private readonly projectiles = new Map<string, ProjectileRecord>();
  private readonly impacts: Mark[] = []; // where shots have connected (#115); aged the same way
  private readonly deaths: Mark[] = []; // where enemies have died (#116); the death-side twin
  readonly build: BuildState; // server-owned; mirrored here so the ghost tests placement locally
  // Whether the squad has found the door (#93). Server-held: the only writes are the two below,
  // each of them inside a handler for a message the server sent, and each of them writing `true`
  // and nothing else. There is no setter and no local rule that could reach it, so a client can
  // neither reveal the door on its own nor take it back once told.
  private exitRevealed = false;
  private lastTick = -1; // highest applied map-delta tick; guards apply-if-newer
  private selfHp: number; // client-authoritative: the owner judges its own contact damage
  // Client clock, stamped when a `structHits` entry last landed. See `structureUnderAttack`.
  private lastStructHitAt = Number.NEGATIVE_INFINITY;
  // Client clock, stamped when the owner last took a blow (#142) — the player-side twin of an
  // enemy's `lastHitAt`. Written in exactly one place, `updateHealth`, which is the only thing in
  // the class that damages anybody: a teammate's health is a render hint that arrives elsewhere, so
  // it can never reach this and a squadmate being bitten can never shake this screen.
  private lastDamageAt = Number.NEGATIVE_INFINITY;
  // Client clock, stamped when the bullet at the head of the forge queue was last seen to start.
  // Null while nothing is forging. See `forgeStartedAt`.
  private forgeAt: number | null = null;

  // `initialHp` carries the owner's HP across a reconnect rebuild (a fresh world defaults to full).
  // Without it, a mid-match reconnect would reset to full and the report loop could relay that heal
  // before the server's peer-health burst reseeds the real value.
  constructor(
    init: WorldInit,
    private readonly selfId: PlayerId,
    initialHp: number = PLAYER_MAX_HP,
  ) {
    this.selfHp = initialHp;
    this.arena = init.arena;
    this.exit = init.exit;
    // Both expanded at the settings the server built the world at, which is why they ride the init
    // (#128). Neither expansion crosses the wire — the ore grid never has, and the nest layout is
    // derived on both sides (ADR 0004) — so settings this client had to guess would put it in a
    // different world from its squad, with no field anywhere to compare.
    //
    // The arena stays its own argument rather than being taken from `settings`, exactly as on the
    // server: the box is the one thing the init states outright, so it cannot be got wrong here.
    this.nests = nestLayout(init.arena, init.nestSeed, init.settings);
    this.ore = generateOre(init.arena, init.oreSeed, init.settings);
    this.build = freshBuildState(init.arena);
    for (const s of init.spawns) {
      this.avatars.set(s.id, {
        id: s.id,
        slot: s.slot,
        name: s.name,
        pos: { ...s.pos },
        buffer: [],
        lastSeq: -1,
        hp: PLAYER_MAX_HP,
        healthSeq: -1,
        gait: freshGait(s.id, s.pos),
      });
    }
  }

  // Advance only the owner's Avatar — peers never move from local input. Three stages, in order:
  // integrate the held input, clamp against structures (`slidePos` resolves the axes separately,
  // so you slide along a wall instead of sticking and a corner is never a hard trap), then get
  // shoved out of any enemy you pressed into.
  //
  // Enemy collision resolves here, on the owner's avatar against the *rendered* enemy stream —
  // the same client-authoritative stance M3 takes for contact damage ("if it touched me on my
  // screen, it hit me"), so the server needs no player-blocking step. Peers are deliberately
  // excluded: they render ~100 ms behind, so blocking against them would be contested.
  stepSelf(dtMs: number, input: MoveInput, now: number): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    const stepped = stepPos(self.pos, input, dtMs, this.arena);
    const slid = slidePos(this.build, self.pos, stepped, PLAYER_RADIUS);
    const pushed = pushOutOfBodies(slid, PLAYER_RADIUS, this.enemyBodies(now), this.arena);
    // Re-clamp: a shove must not push you through a wall you were standing against.
    self.pos = slidePos(this.build, slid, pushed, PLAYER_RADIUS);
  }

  // Every enemy as the owner currently sees it — the interpolated stream, not the raw samples.
  private enemyBodies(now: number): Body[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return [...this.enemies.values()].map((e) => ({
      pos: interpolateAt(e.buffer, renderTime) ?? e.pos,
      radius: enemyRadius(e.kind),
    }));
  }

  // Apply a relayed position, dropping a stale/duplicate frame by its per-peer seq. The
  // owner's own frames (only ever a reconnect burst) seed its live position instantly; a
  // peer's frames are buffered by arrival time for interpolation. Unknown ids are ignored —
  // M2 supports reconnect, not a brand-new mid-match joiner.
  applyPeer(id: PlayerId, pos: Vec2, seq: number, arrivalMs: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar || seq <= avatar.lastSeq) return;
    avatar.lastSeq = seq;
    if (id === this.selfId) {
      avatar.pos = { x: pos.x, y: pos.y };
      return;
    }
    this.pushSample(avatar.buffer, pos, arrivalMs);
  }

  // Apply a relayed HP, dropping a stale/duplicate frame by its per-peer seq. A peer's HP is a
  // render hint (a corpse draws distinctly); the owner's own frame (a reconnect burst) reseeds
  // its authoritative local HP.
  applyPeerHealth(id: PlayerId, hp: number, seq: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar || seq <= avatar.healthSeq) return;
    avatar.healthSeq = seq;
    avatar.hp = hp;
    if (id === this.selfId) this.selfHp = hp;
  }

  // Advance the owner's health one frame: any enemy in contact with the owner's TRUE position
  // (checked against the enemy's rendered position) deals its contact damage on its own cadence.
  // "If it touched me on my screen, it hit me." A dead owner takes no further damage.
  updateHealth(now: number): void {
    if (this.selfHp <= 0) return;
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    for (const enemy of this.enemies.values()) {
      const pos = interpolateAt(enemy.buffer, renderTime) ?? enemy.pos;
      const touching =
        Math.hypot(pos.x - self.pos.x, pos.y - self.pos.y) <=
        PLAYER_RADIUS + enemyRadius(enemy.kind);
      if (!touching) continue;
      if (now - enemy.lastContactAt >= enemyContactCadenceMs(enemy.kind)) {
        this.selfHp = Math.max(0, this.selfHp - enemyContactDamage(enemy.kind));
        enemy.lastContactAt = now;
        this.lastDamageAt = now;
      }
    }
  }

  // One bloodling going off at `at` (#140). The owner takes `BLAST_DAMAGE` if it is standing inside
  // the blast — measured from its body's centre, like every other reach in this class — and a dead
  // owner takes nothing, exactly as it takes no further bite.
  //
  // No cadence and no per-enemy stamp, unlike contact damage: a blast happens once because the
  // thing that dealt it is gone, and `applyMapDelta` drops a stale delta before it reaches here, so
  // there is no repeat for a cadence to hold off.
  private blast(at: Vec2, now: number): void {
    if (this.selfHp <= 0) return;
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    if (Math.hypot(at.x - self.pos.x, at.y - self.pos.y) > BLAST_RADIUS) return;
    this.selfHp = Math.max(0, this.selfHp - BLAST_DAMAGE);
    this.lastDamageAt = now;
  }

  hp(): number {
    return this.selfHp;
  }

  // When the owner last took a blow, on this client's own clock, or negative infinity before the
  // first one (#142). An instant and not a duration, exactly as `forgeStartedAt` is: how long the
  // screen shakes and how long it stays black are `damageFx`'s, so nothing about the effect's shape
  // or its length lives in the state that triggers it.
  damagedAt(): number {
    return this.lastDamageAt;
  }

  isDead(): boolean {
    return this.selfHp <= 0;
  }

  // Respawn the owner: snap back to arena center at full HP. The caller resumes streaming and
  // reports the new HP. Center is safe (the front line holds far out), so no contact re-triggers.
  reviveSelf(): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    self.pos = { x: this.arena.width / 2, y: this.arena.height / 2 };
    this.selfHp = PLAYER_MAX_HP;
  }

  // Apply one enemy/combat tick, dropping a stale/out-of-order delta by its monotonic tick.
  // Spawns create a render record before their positions flow; moves buffer each enemy's
  // position for the same delayed interpolation peers use; deaths remove it. Mutates in place —
  // the render loop reads this every frame, so no React re-render at the ~20 Hz tick rate.
  applyMapDelta(delta: MapDelta, now: number): void {
    if (delta.tick <= this.lastTick) return;
    this.lastTick = delta.tick;
    for (const s of delta.spawns ?? []) {
      // A duplicate spawn must not reset the record, because the record now carries derived
      // facing state. That is only safe because `addEnemy` never recycles an id (`enemies.ts`
      // increments `nextId` for the life of the session) — if allocation ever stops being
      // monotonic, a repeat id is a different enemy and this guard has to reseed the gait.
      if (!this.enemies.has(s.id)) {
        this.enemies.set(s.id, {
          id: s.id,
          kind: s.kind,
          hp: s.hp,
          pos: { ...s.pos },
          buffer: [],
          lastContactAt: Number.NEGATIVE_INFINITY,
          lastHitAt: Number.NEGATIVE_INFINITY,
          gait: freshGait(s.id, s.pos),
        });
      }
    }
    for (const [id, x, y] of delta.moves) {
      const enemy = this.enemies.get(id);
      if (enemy) this.pushSample(enemy.buffer, { x, y }, now);
    }
    for (const hit of delta.hits ?? []) {
      const enemy = this.enemies.get(hit.id);
      if (!enemy) continue;
      enemy.hp = hit.hp;
      enemy.lastHitAt = now; // arrival, not render time: `renderEnemies` is what applies the delay
      // Where the blow landed, sampled at `now` — which the `moves` loop above has just pushed this
      // enemy's sample for, since every live enemy rides every delta. That is precisely the point
      // `renderEnemies` will interpolate this spider to when the delayed clock reaches this instant,
      // so the burst lands on the drawing rather than beside it. An enemy spawned this tick with no
      // move behind it yet falls back to the spawn position, which is what its sprite is showing.
      this.impacts.push({ pos: interpolateAt(enemy.buffer, now) ?? { ...enemy.pos }, at: now });
    }
    for (const id of delta.deaths ?? []) {
      const enemy = this.enemies.get(id);
      // Sampled on the *delayed* clock, unlike an impact's mark: this is the last point the sprite
      // was interpolated to before the line below took it off the screen, and it is a whole render
      // delay short of where the stream has the spider by now. The puff stands in for a drawing, so
      // it goes where that drawing was. An enemy killed before its first move sample falls back to
      // the spawn position, which is what its sprite was showing.
      if (enemy) {
        const where = interpolateAt(enemy.buffer, now - ENEMY_RENDER_DELAY_MS) ?? { ...enemy.pos };
        this.deaths.push({ pos: where, at: now });
        // A bloodling's death *is* its blast (#140), so the blow lands here — off the death the
        // client is already streamed, with nothing added to the wire to carry it. That the sim
        // kills it by arriving and that a squadmate shoots it are the same event to this class,
        // and deliberately: a bloodling that bursts point-blank because somebody shot it still
        // bursts. The owner owns its health, so it judges the blow itself, on the same terms it
        // judges a bite — its own true position, against the point the spider was drawn at.
        if (enemy.kind === "bloodling") this.blast(where, now);
      }
      this.enemies.delete(id);
    }
    for (const nd of delta.nests ?? []) {
      const nest = this.nests.find((n) => n.id === nd.id);
      if (nest) {
        nest.hp = nd.hp;
        nest.alive = nd.alive;
      }
    }
    if (delta.exitRevealed) this.exitRevealed = true;
    if (delta.bank) this.build.bank.metal = delta.bank.metal;
    // Tested against undefined, not truthiness: an emptied pool arrives as a 0, which is exactly
    // the value the trigger has to see.
    if (delta.ammo !== undefined) {
      // A bullet arriving is what restarts the forge on the one behind it, and it is the only
      // signal that survives a completion and a fresh order landing on the same tick — which
      // leaves `queued` exactly where it was.
      if (delta.ammo > this.build.ammo.bullets) this.forgeAt = now;
      this.build.ammo.bullets = delta.ammo;
    }
    if (delta.queued !== undefined) {
      if (this.build.ammo.queued === 0 && delta.queued > 0) this.forgeAt = now;
      this.build.ammo.queued = delta.queued;
    }
    if (this.build.ammo.queued === 0) this.forgeAt = null;
    if (delta.power) this.build.power = { ...delta.power };
    for (const b of delta.builds ?? []) {
      if (!this.build.structures.has(b.id)) insertStructure(this.build, { ...b });
    }
    for (const h of delta.structHits ?? []) {
      const structure = this.build.structures.get(h.id);
      if (!structure) continue; // an id this client has never seen says nothing about our base
      structure.hp = h.hp;
      this.lastStructHitAt = now;
    }
    // After `builds`: a turret placed this tick can already be holding a target in the same delta.
    this.applyAims(delta.aims ?? []);
    for (const id of delta.removals ?? []) removeStructure(this.build, id);
    // Every shot the server put in the air this tick, and every shot it took out of one. The
    // owner's own are adopted like anybody else's — since #80 a client draws no shot of its own
    // accord, which is what makes "a refused shot draws nothing" (#85) a property of where
    // projectiles come from rather than a set of gates that have to agree with the server's.
    this.launch(delta.projectiles ?? [], now);
    for (const id of delta.spent ?? []) {
      const shot = this.projectiles.get(id);
      if (shot) shot.endAt = now;
    }
    // Pruned off the stream rather than off the frame, on the delayed clock they are drawn against:
    // a record whose flight has ended for the *renderer* is the one there is nothing left to draw.
    const flown = now - ENEMY_RENDER_DELAY_MS;
    for (const shot of this.projectiles.values()) {
      if (flown > shot.endAt) this.projectiles.delete(shot.id);
    }
    // Pruned off the stream rather than off the frame, because a tab that has stopped drawing is
    // still taking every delta — and at the rate hits arrive, a match nobody is looking at would
    // otherwise hold every mark it ever laid.
    const marked = now - IMPACT_RETENTION_MS;
    while (this.impacts.length > 0 && this.impacts[0].at < marked) this.impacts.shift();
    const buried = now - DEATH_RETENTION_MS;
    while (this.deaths.length > 0 && this.deaths[0].at < buried) this.deaths.shift();
  }

  // Take up the shots the server launched this tick. The arrival stamp is the flight's origin in
  // time, exactly as an impact mark's is: the delay the renderer owes the spiders is applied once,
  // in `renderProjectiles`, rather than baked into every stamp here.
  private launch(spawns: ProjectileSpawn[], now: number): void {
    for (const [id, x, y, dx, dy] of spawns) {
      this.projectiles.set(id, {
        id,
        from: { x, y },
        dir: { x: dx, y: dy },
        at: now,
        // Until a `spent` says otherwise: the longest any shot in the game can be in the air.
        endAt: now + PROJECTILE_FLIGHT_MS,
      });
    }
  }

  // Adopt streamed turret aims. Only turrets carry a runtime, and an id for a structure this
  // client has never seen is ignored — the same unknown-id guard `moves` already applies.
  private applyAims(aims: TurretAim[]): void {
    for (const [id, target, powered] of aims) {
      const turret = this.build.structures.get(id)?.turret;
      if (!turret) continue;
      turret.targetId = target;
      turret.powered = powered === 1;
    }
  }

  // Whether something the squad built has been bitten within the last `windowMs`.
  //
  // This is the state #76 asks the HUD's warning icon to show, and no snapshot carries it: the
  // wire reports *damage*, an edge, while the icon reports *being attacked*, a condition. The gap
  // between them is the window — a spider bites on a cadence, so a base actually under attack
  // refreshes this every bite and one that has been left alone lets it lapse.
  //
  // Derived from `structHits` alone. `removals` looks like the same signal and is not: it also
  // carries a structure the squad demolished on purpose, which would flash an attack warning at a
  // player tidying up their own base.
  structureUnderAttack(now: number, windowMs: number): boolean {
    return now - this.lastStructHitAt < windowMs;
  }

  // The marks whose sprites have caught up with them and that are still up — the starbursts this
  // frame strikes (#115), oldest first.
  //
  // Judged on `renderTime` and never on `now`, exactly as `flashing` is and for the same reason: a
  // hit rides the 20 Hz tick while the spider it belongs to is a render delay behind it, so a burst
  // stamped against arrival fires `ENEMY_RENDER_DELAY_MS` ahead of the drawing it belongs to. A mark
  // the sprites have not reached yet is not late — it is early, and it is held back until they do.
  //
  // The lifetime is the caller's, so nothing about how long a burst is up lives in the state that
  // spawns it. A shot has no lifetime to share any more — since #80 it is drawn until the server
  // says it is spent (`renderProjectiles`).
  impactMarks(now: number, lifeMs: number): Mark[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return this.impacts.filter((m) => {
      const since = renderTime - m.at;
      return since >= 0 && since < lifeMs;
    });
  }

  // The puffs still up — the ink struck where enemies died this frame (#116), oldest first.
  //
  // **Judged on `now` and never on `renderTime`, which is the one place this parts company with
  // `impactMarks`.** A hit's sprite has yet to reach the blow, so its mark is held back for the
  // render delay; a death's sprite is *deleted* by `applyMapDelta` the instant the delta lands, so
  // there is nothing left for the puff to wait for. Held back the same way it would start
  // `ENEMY_RENDER_DELAY_MS` after the spider it replaces had already gone, which is a visible hole
  // in the frame. The delay is spent on the mark's *position* instead — see the deaths loop above —
  // so the puff still stands where the drawing was rather than where the stream had got to.
  //
  // The lifetime is the caller's, like a burst's. There is no floor under it as `impactMarks` has,
  // because the floor is what holds a mark back and this one is never held: the frame that is
  // somehow asking before the delta it is answering has already lost the spider.
  deathMarks(now: number, lifeMs: number): Mark[] {
    return this.deaths.filter((m) => now - m.at < lifeMs);
  }

  // Rebuild the economy from the reconnect keyframe: the bank and every building the squad has
  // standing. The ore grid needs nothing — it was derived from the seed when this world was built.
  initBuild(msg: {
    bank: Bank;
    ammo: number;
    queued: number;
    power: Power;
    structures: StructureSpawn[];
    aims: TurretAim[];
  }): void {
    for (const id of [...this.build.structures.keys()]) removeStructure(this.build, id);
    for (const s of msg.structures) insertStructure(this.build, { ...s });
    this.build.bank.metal = msg.bank.metal;
    this.build.ammo.bullets = msg.ammo;
    // How many are queued, and nothing about how far the one at the head has got — the keyframe
    // does not carry that and cannot be guessed. The clock stays unanchored until the next bullet
    // lands, at most one forge away; anchoring here would draw a countdown from a phase nobody sent.
    this.build.ammo.queued = msg.queued;
    this.forgeAt = null;
    this.build.power = { ...msg.power };
    // Rebuilding a turret mints it un-aimed, so the keyframe's aims are what restore the lines and
    // the lightning a reconnecter would otherwise never be told about.
    this.applyAims(msg.aims);
  }

  // The shared Metal readout. The server sends whole Metal, so this needs no rounding of its own.
  metal(): number {
    return this.build.bank.metal;
  }

  // How many enemies this client is tracking. Read for one thing only — whether an enemy has ever
  // *appeared* on this client, which is what raises the tutorial's gun prompt (#134) — so it is a
  // count rather than a list: nothing about that question needs a position, and the alternative is
  // taking a whole `snapshot` for it.
  enemyCount(): number {
    return this.enemies.size;
  }

  // The squad's spendable bullets (#102). Mirrored, never computed: the pool is server-owned and
  // the forge queue behind it never crosses the wire. This is what the trigger is gated on, so a
  // shot the server would refuse for want of a bullet is never drawn (#85).
  ammo(): number {
    return this.build.ammo.bullets;
  }

  // Bullets ordered, paid for, and still forging (#102) — the figure the HUD's circle states.
  queuedBullets(): number {
    return this.build.ammo.queued;
  }

  // When the bullet at the head of the queue was last seen to start forging, on this client's own
  // clock, or null while nothing is forging. This is an *anchor*, not a countdown: the forge runs
  // at `FORGE_MS` a bullet, so the HUD integrates from here and needs no per-tick figure. It is
  // late by whatever the arrival was — at worst a tick plus the trip — and every completion resets
  // it, so the error cannot accumulate.
  forgeStartedAt(): number | null {
    return this.forgeAt;
  }

  // Metal per second the squad's miners are paying in (#105). Per squad, not per player: the bank is
  // shared and miners are communal. Derived from the mirrored structure set rather than streamed, so
  // it costs nothing on the wire and a miner leaves the reading the tick its removal arrives.
  metalRate(): number {
    return metalRate(this.build);
  }

  // What a buildable would cost the squad right now (#101), for the build bar's cost circle.
  // Derived from the mirrored structure set like `metalRate`, so the bar quotes the very number
  // server-side admission will charge and the ghost is already testing against.
  buildCost(kind: BuildableKind): number {
    return buildCost(kind, this.build);
  }

  // The live energy rate: what the grid can generate, and what is drawing against it.
  power(): Power {
    return this.build.power;
  }

  // Rebuild live enemy/nest state from the reconnect keyframe — world-init only carries the
  // initial static set, so a mid-match (re)joiner needs this to see enemies that moved/died/
  // spawned and nests that were silenced. Seeds `lastTick` so the first live delta isn't dropped.
  // The door's reveal is adopted and never cleared: a keyframe that omits it is silent about the
  // door, not a denial, so a rebuild cannot hide a door this client has already been shown.
  initEnemies(msg: {
    tick: number;
    enemies: EnemySnapshot[];
    nests: NestSnapshot[];
    exitRevealed?: true;
  }): void {
    if (msg.exitRevealed) this.exitRevealed = true;
    this.enemies.clear();
    for (const e of msg.enemies) {
      this.enemies.set(e.id, {
        id: e.id,
        kind: e.kind,
        hp: e.hp,
        pos: { ...e.pos },
        buffer: [],
        lastContactAt: Number.NEGATIVE_INFINITY,
        lastHitAt: Number.NEGATIVE_INFINITY,
        gait: freshGait(e.id, e.pos),
      });
    }
    for (const ns of msg.nests) {
      const nest = this.nests.find((n) => n.id === ns.id);
      if (nest) {
        nest.hp = ns.hp;
        nest.alive = ns.alive;
      }
    }
    this.lastTick = msg.tick;
  }

  removePeer(id: PlayerId): void {
    this.avatars.delete(id);
  }

  // Append an arrival-stamped sample and prune history older than the buffer window.
  private pushSample(buffer: PosSample[], pos: Vec2, t: number): void {
    buffer.push({ t, pos: { x: pos.x, y: pos.y } });
    const cutoff = t - BUFFER_MS;
    while (buffer.length > 1 && buffer[0].t < cutoff) buffer.shift();
  }

  selfPos(): Vec2 | null {
    const self = this.avatars.get(this.selfId);
    return self ? { ...self.pos } : null;
  }

  // Assemble the render model. The owner is drawn at its live position; peers are sampled
  // RENDER_DELAY_MS behind `now` from their buffers. Each entity's facing and walk frame are
  // advanced here, where its rendered position has just been computed — so this is a command as
  // much as a query. Calling it twice with the *same* `now` is a no-op; calling it twice with
  // different `now` in one frame splits the EMA step and biases the speed ~1% low. The render
  // loop is the single caller, once per frame; a second consumer wants `advance`/`snapshot`
  // split apart rather than caller discipline.
  snapshot(now: number): WorldSnapshot {
    return {
      arena: this.arena,
      players: [...this.avatars.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((a) => this.render(a, now)),
      enemies: this.renderEnemies(now),
      projectiles: this.renderProjectiles(now),
      nests: this.nests.map(renderNest),
      exit: this.exit,
      exitRevealed: this.exitRevealed,
      ore: this.ore,
      structures: [...this.build.structures.values()],
    };
  }

  // The owner's facing is derived from its position like everyone else's, deliberately, and not
  // from its `MoveInput`: pressing into a wall would then read as movement here and as a held
  // facing on every other screen.
  private render(a: AvatarRecord, now: number): Avatar {
    const isSelf = a.id === this.selfId;
    const pos = isSelf ? a.pos : (interpolateAt(a.buffer, now - RENDER_DELAY_MS) ?? a.pos);
    const hp = isSelf ? this.selfHp : a.hp;
    updateFacing(a.gait, pos, now);
    return {
      id: a.id,
      slot: a.slot,
      name: a.name,
      pos: { ...pos },
      radius: PLAYER_RADIUS,
      hp,
      facing: a.gait.facing,
      frame: a.gait.frame,
    };
  }

  // Where every shot in the air has got to this frame (#80), integrated here rather than received.
  //
  // **Judged on the delayed clock the spiders render on, and that is the whole of why it is judged
  // at all.** The server applies the blow on the tick a shot arrives; the body it arrived at is
  // drawn `ENEMY_RENDER_DELAY_MS` behind that stream. A bullet flown on the live clock would reach
  // the spider a render delay before the spider was drawn taking it — the same off-by-a-delay
  // #107's flash and #115's burst are both already corrected for.
  //
  // A shot the delayed clock has not reached yet is not drawn, and neither is one it has flown
  // past: `endAt` is the `spent` the server sent, or the furthest it could be if none has come.
  // Clamped to `PROJECTILE_RANGE` as well, which is belt and braces — a flight that has run past
  // its reach has already been pruned — and cheap enough to keep as the one thing standing between
  // a stalled tab and a bullet halfway across the arena.
  private renderProjectiles(now: number): RenderedProjectile[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    const flying: RenderedProjectile[] = [];
    for (const shot of this.projectiles.values()) {
      const since = renderTime - shot.at;
      if (since < 0 || renderTime > shot.endAt) continue;
      const flown = Math.min((PROJECTILE_SPEED * since) / 1000, PROJECTILE_RANGE);
      flying.push({
        id: shot.id,
        from: { ...shot.from },
        pos: { x: shot.from.x + shot.dir.x * flown, y: shot.from.y + shot.dir.y * flown },
      });
    }
    return flying;
  }

  private renderEnemies(now: number): RenderedEnemy[] {
    const renderTime = now - ENEMY_RENDER_DELAY_MS;
    return [...this.enemies.values()].map((e) => {
      const pos = interpolateAt(e.buffer, renderTime) ?? { ...e.pos };
      updateFacing(e.gait, pos, now);
      // Measured on `renderTime`, the instant this sprite is being interpolated to, rather than on
      // `now`: a hit rides the 20 Hz tick while the sprite it belongs to is a render delay behind
      // it, so timing the flash off arrival would fire it 50 ms ahead of the drawing (#107).
      const sinceHit = renderTime - e.lastHitAt;
      return {
        id: e.id,
        kind: e.kind,
        hp: e.hp,
        radius: enemyRadius(e.kind),
        pos,
        facing: e.gait.facing,
        frame: e.gait.frame,
        flashing: sinceHit >= 0 && sinceHit < HIT_FLASH_MS,
      };
    });
  }
}

function renderNest(n: Nest): RenderedNest {
  return {
    id: n.id,
    pos: { ...n.pos },
    radius: NEST_RADIUS,
    hp: n.hp,
    maxHp: n.maxHp,
    alive: n.alive,
  };
}
