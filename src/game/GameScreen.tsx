import { useEffect, useRef, useState } from "react";
import type { LobbyState } from "../lobby/client";
import type { Arena, BuildableKind, MoveInput, Tile, Vec2 } from "../lobby/protocol";
import { createSpriteCache } from "../sprite/cache";
import reconnectingIcon from "../sprite/reconnecting";
import { SPRITES } from "../sprite/registry";
import { SpriteIcon } from "../sprite/SpriteIcon";
import warningIcon from "../sprite/warning";
import {
  BUILD_SLOTS,
  BUILDABLES,
  DEMOLISH_HOLD_MS,
  type HarvestTarget,
  INTERACT_REACH,
  MINE_CADENCE_MS,
  placementError,
  resolveHarvest,
  tileCenter,
  tileOf,
  withinReach,
} from "./build";
import { type Camera, computeCamera } from "./camera";
import { type ClientWorld, RESPAWN_DELAY_MS } from "./clientWorld";
import { type BuildGhost, drawWorld, type OwnShot, SHOT_LINE_MS } from "./draw";
import { RANGED_CADENCE_MS } from "./enemies";
import { freshMetalFloats, stepMetalFloats } from "./floats";
import { aimDir, keyToBuildSlot, keyToDirection, movesEqual, NO_MOVE } from "./input";
import { PLAYER_MAX_HP } from "./world";

const POS_SEND_MS = 50; // ~20 Hz position stream, independent of the render frame rate
const MAX_FRAME_MS = 100; // cap dt so a backgrounded tab doesn't teleport the avatar on resume
// How long after the last bite a structure still counts as under attack. Comfortably longer than a
// spider's bite cadence, so a base being chewed holds the warning steady rather than strobing it
// between bites, and short enough that the bell stops soon after the last spider is off it.
const UNDER_ATTACK_MS = 2000;
const BUILD_ICON_PX = 26; // the buildable's own sprite, shrunk to fit a slot
// What a slot is called on screen (#98) — the author's wording, one word each. `mine` is the label
// for a `miner`: a display string, so the domain type keeps the name the whole build path uses.
const BUILD_NAMES: Record<BuildableKind, string> = {
  miner: "mine",
  wall: "wall",
  turret: "turret",
  generator: "generator",
};

// Every slot's live Metal price, in bar order. A turret's climbs with the squad's standing turrets
// (#101), so the circle is mirrored from the world on the HUD's timer rather than read once.
// Before the world exists the squad has nothing standing, which is exactly the registry price.
const slotCosts = (world: ClientWorld | undefined): number[] =>
  BUILD_SLOTS.map((kind) => world?.buildCost(kind) ?? BUILDABLES[kind]?.cost ?? 0);

// One cache for the app: a baked sprite depends on the display, not on which screen is mounted.
// It bakes nothing until something is drawn, so importing this costs nothing under `bun test`,
// where there is no canvas to bake into.
const spriteCache = createSpriteCache(SPRITES);

interface GameScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onPos: (pos: Vec2) => void;
  onAttack: (pos: Vec2, dir: Vec2) => void;
  onHealth: (hp: number) => void;
  onMine: (tile: Tile) => void;
  onBuild: (kind: BuildableKind, tile: Tile) => void;
  onDemolish: (id: string) => void;
}

// The in-match screen: a fullscreen camera that follows your Avatar through the giant box.
// A single render loop integrates the owner locally each frame (zero input lag), samples
// peers render-delay behind from their buffers, clamps the camera at the walls, culls
// off-screen entities, and paints via a DPR-correct transform (1 world unit = 1 CSS px,
// crisp on HiDPI). The owner's position streams out at a fixed ~20 Hz. Refs bridge React's
// render into the loop so a world swapped on reconnect and a changed callback are picked up
// without restarting it.
export function GameScreen({
  state,
  onLeave,
  onPos,
  onAttack,
  onHealth,
  onMine,
  onBuild,
  onDemolish,
}: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<MoveInput>(NO_MOVE);
  const worldRef = useRef(state.world);
  const selfIdRef = useRef(state.self?.id);
  const onPosRef = useRef(onPos);
  const onAttackRef = useRef(onAttack);
  const onHealthRef = useRef(onHealth);
  const onMineRef = useRef(onMine);
  const onBuildRef = useRef(onBuild);
  const onDemolishRef = useRef(onDemolish);
  // When right-click went down, or null if it is up. A timestamp rather than a flag because
  // demolish only fires once the button has been held a while.
  const harvestingRef = useRef<number | null>(null);
  // When the last shot actually went out. The cadence is enforced here as well as in the server's
  // `admitAttack` because a fast-clicking player would otherwise send, and draw a line for, shots
  // the server refused. A drawn line must never imply damage nobody applied.
  //
  // Exactly `RANGED_CADENCE_MS`, not a hair more: the server measures arrival-to-arrival where
  // this measures click-to-click, so a shot sent right on the boundary can still land early under
  // negative jitter and be refused. Widening the gate here would cut the sustained rate of fire,
  // and M5 (#81) permits no balance change. The boundary case is accepted.
  const lastAttackRef = useRef(Number.NEGATIVE_INFINITY);
  // Your own last shot, kept so its line can be drawn from here rather than from the relay the
  // server sends back to the whole squad. `drawWorld` ages it; nothing has to clear it.
  const ownShotRef = useRef<OwnShot | null>(null);
  // The `+1`s the squad's miners are throwing up (#99). Client-derived from the mirrored structure
  // set, so it lives with the loop that draws it rather than on the wire or in `ClientWorld` — the
  // beat is the same one the bank is paid on, but which miners *emit* is a question about the camera.
  const floatsRef = useRef(freshMetalFloats());
  const [selected, setSelected] = useState<BuildableKind | null>(null);
  const selectedRef = useRef(selected); // the render loop and the click handler read it un-stale
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const [hp, setHp] = useState(PLAYER_MAX_HP); // mirrored into React only to drive the HUD
  const [metal, setMetal] = useState(0); // the shared bank, mirrored into React for the HUD
  const [metalRate, setMetalRate] = useState(0); // shown on the reveal behind the total (#105)
  const [power, setPower] = useState({ generation: 0, consumption: 0 }); // the live energy rate
  const [costs, setCosts] = useState(() => slotCosts(state.world)); // the build bar's cost circles
  const [underAttack, setUnderAttack] = useState(false); // drives the HUD's warning bell
  const viewRef = useRef({ w: 0, h: 0, dpr: 1 }); // CSS viewport size + device pixel ratio
  const pointerRef = useRef<Vec2>({ x: 0, y: 0 }); // latest pointer, CSS px within the canvas
  const aimRef = useRef<{ camera: Camera; self: Vec2 }>({
    camera: { x: 0, y: 0 },
    self: { x: 0, y: 0 },
  }); // the render loop's latest camera + self world pos, so a click aims from the true origin
  worldRef.current = state.world;
  selfIdRef.current = state.self?.id;
  onPosRef.current = onPos;
  onAttackRef.current = onAttack;
  onHealthRef.current = onHealth;
  onMineRef.current = onMine;
  onBuildRef.current = onBuild;
  onDemolishRef.current = onDemolish;
  selectedRef.current = selected;

  // Keyboard → held MoveInput, plus the build bar's 1–4 and the menu's Escape. Nothing is sent
  // per key.
  useEffect(() => {
    const setHeld = (direction: keyof MoveInput, down: boolean) => {
      const next = { ...heldRef.current, [direction]: down };
      if (movesEqual(next, heldRef.current)) return; // only react to a real change
      heldRef.current = next;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A shown `<dialog>` closes itself on an Escape the page did not consume, which would fight
        // this toggle for the same key. Cancelling the event suppresses that close request and
        // leaves the menu's open state to exactly one owner.
        e.preventDefault();
        setMenuOpen((open) => !open);
        return;
      }
      const slot = keyToBuildSlot(e.key, BUILD_SLOTS.length);
      if (slot !== null) {
        setSelected(BUILD_SLOTS[slot]);
        return;
      }
      const direction = keyToDirection(e.key);
      if (!direction) return;
      e.preventDefault(); // arrow keys otherwise scroll the page
      setHeld(direction, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const direction = keyToDirection(e.key);
      if (!direction) return;
      setHeld(direction, false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // The menu is a real modal — `showModal` is what puts it in the top layer and makes the match
  // behind it inert to the pointer — over a match that is still running. Nothing pauses: the
  // world is server-authoritative and the squad is still playing, so the only thing opening it
  // changes is that held movement is let go and you stand still.
  useEffect(() => {
    if (!menuOpen) return;
    heldRef.current = NO_MOVE;
    menuRef.current?.showModal();
    // Focus is placed rather than left to `showModal`'s own focusing step, which not every DOM
    // implements. Escape has no invoking element to hand focus back to on close, so it goes to the
    // arena — the surface the menu was opened over, and where the keys were already going.
    leaveRef.current?.focus();
    return () => canvasRef.current?.focus();
  }, [menuOpen]);

  // Track the CSS viewport size and size the backing store to device pixels (crisp HiDPI).
  // ResizeObserver reports content-box changes without a per-frame layout read; the loop
  // handles a pure DPR change (moving to a different-density monitor) itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sync = () => sizeBackingStore(canvas, viewRef);
    sync();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(sync);
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      const canvas = canvasRef.current;
      const world = worldRef.current;
      if (canvas && world) {
        const dpr = window.devicePixelRatio || 1;
        if (dpr !== viewRef.current.dpr) resizeForDpr(canvas, viewRef, dpr);
        // One clock for the whole frame. `snapshot` advances each entity's gait on the `now` it is
        // given, and the shot lines resolve their targets against the same interpolation it renders
        // on — reading the clock twice would split that step and land a line off its own sprite.
        const clock = Date.now();
        // Hand-mining pins you where you stand (#109). The pin is the harvest itself, read fresh
        // every frame rather than latched, so it takes hold on the very frame the button goes down
        // and is gone on the frame it comes up — with no stale flag for a blur or a death to strand.
        const pinned =
          liveHarvest(world, harvestingRef.current, pointerRef.current, aimRef.current.camera)
            ?.kind === "mine";
        const move = pinned ? NO_MOVE : heldRef.current;
        if (!world.isDead()) world.stepSelf(dt, move, clock); // a downed player holds still
        world.updateHealth(clock); // judge contact damage at the owner's true position
        const { w, h } = viewRef.current;
        const ctx = w > 0 && h > 0 ? canvas.getContext("2d") : null;
        if (ctx) {
          const snapshot = world.snapshot(clock);
          const self = selfPos(snapshot.players, selfIdRef.current) ?? center(world.arena);
          const viewport = { width: w, height: h };
          const camera = computeCamera(self, viewport, world.arena);
          aimRef.current = { camera, self }; // feed the attack handlers the live origin + camera
          ctx.setTransform(dpr, 0, 0, dpr, -camera.x * dpr, -camera.y * dpr);
          const kind = selectedRef.current;
          const ghost: BuildGhost | undefined = kind
            ? {
                kind,
                tile: cursorTile(pointerRef.current, camera),
                // The ghost runs the very rule the server will: same registry, same ore, same
                // mirrored build state — so green never turns into a rejected placement.
                valid:
                  placementError(
                    kind,
                    cursorTile(pointerRef.current, camera),
                    world.ore,
                    world.build,
                    self,
                  ) === null,
              }
            : undefined;
          // Asking the cache for this frame's DPR is also what re-bakes the set when the window
          // moves to a display of a different density: every bake in hand is then the wrong
          // resolution, and the cache empties itself rather than being told to.
          drawWorld(ctx, snapshot, {
            selfId: selfIdRef.current,
            camera,
            viewport,
            ghost,
            dpr,
            now: clock,
            floats: stepMetalFloats(
              floatsRef.current,
              snapshot.structures,
              camera,
              viewport,
              clock,
            ),
            sprites: spriteCache.source(dpr),
            shots: {
              // Aged to the line's own lifetime, never to the buffer's longer retention window.
              peers: world.peerShots(clock, SHOT_LINE_MS),
              own: ownShotRef.current,
              resolve: (id) => world.shotTargetPos(id, clock),
            },
          });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let lastHp = PLAYER_MAX_HP;
    let deadSince: number | null = null;
    const timer = setInterval(() => {
      const world = worldRef.current;
      if (!world) return;
      const now = Date.now();
      // Client-run respawn: after the delay, snap back to center at full HP. The countdown is no
      // longer shown — ADR 0001 took the text and granted it no icon — but the timer still runs.
      if (world.isDead()) {
        deadSince ??= now;
        if (now - deadSince >= RESPAWN_DELAY_MS) {
          world.reviveSelf();
          deadSince = null;
        }
      } else {
        deadSince = null;
      }
      setUnderAttack(world.structureUnderAttack(now, UNDER_ATTACK_MS));
      const nextHp = world.hp();
      if (nextHp !== lastHp) {
        lastHp = nextHp;
        setHp(nextHp); // repaint the HUD (rare — only on a health change)
        onHealthRef.current(nextHp); // report it; hp <= 0 declares death, max declares the revive
      }
      setMetal(world.metal()); // React bails out when the whole-metal readout hasn't moved
      setMetalRate(world.metalRate());
      const live = world.power();
      setPower((shown) =>
        shown.generation === live.generation && shown.consumption === live.consumption
          ? shown // same numbers: return the same object so React bails out of the re-render
          : { ...live },
      );
      setCosts((shown) => {
        const next = slotCosts(world);
        return next.every((cost, i) => cost === shown[i]) ? shown : next;
      });
      // A downed player stops streaming position — peers hold its last pos as a corpse.
      if (!world.isDead()) {
        const pos = world.selfPos();
        if (pos) onPosRef.current(pos);
      }
    }, POS_SEND_MS);
    return () => clearInterval(timer);
  }, []);

  // Held right-click streams a harvest request for whatever is under the cursor at a fixed
  // cadence. The server decides what that is worth — the client only ever asks.
  useEffect(() => {
    const timer = setInterval(() => {
      const heldSince = harvestingRef.current;
      if (heldSince === null) return;
      const target = liveHarvest(
        worldRef.current,
        heldSince,
        pointerRef.current,
        aimRef.current.camera,
      );
      if (target?.kind === "mine") onMineRef.current(target.tile);
      // Demolish waits out a hold: a stray right-click while running over your own wall must not
      // delete it. Mining needs no such guard — a single mine tick is harmless.
      else if (target?.kind === "demolish" && Date.now() - heldSince >= DEMOLISH_HOLD_MS) {
        onDemolishRef.current(target.id);
      }
    }, MINE_CADENCE_MS);
    return () => clearInterval(timer);
  }, []);

  // A right-click released outside the canvas (or with the tab hidden) must still stop the hold,
  // or harvesting would continue with a stale cursor.
  useEffect(() => {
    const stop = () => {
      harvestingRef.current = null;
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  const trackPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    trackPointer(e);
    if (e.button === 0) {
      const { camera, self } = aimRef.current;
      const kind = selectedRef.current;
      // Left-click is one button with two jobs: place the selected buildable, or shoot when
      // nothing is selected.
      const now = Date.now();
      if (kind) {
        onBuildRef.current(kind, cursorTile(pointerRef.current, camera));
        // A downed player holds still and cannot mine; it does not shoot either. Death is read
        // first, so waiting to respawn never spends the cadence and costs the first shot back on
        // your feet — and no line is drawn for a shot the server now refuses (#85).
      } else if (!worldRef.current?.isDead() && now - lastAttackRef.current >= RANGED_CADENCE_MS) {
        lastAttackRef.current = now;
        const dir = aimDir(pointerRef.current, self, camera);
        ownShotRef.current = { at: now, from: { ...self }, dir };
        onAttackRef.current({ ...self }, dir);
      }
    } else if (e.button === 2) {
      // Right-click is one button with two jobs too: cancel the selected buildable, or harvest
      // when nothing is selected. Cancelling deliberately falls through to neither — arming the
      // hold here would start mining the tile the cancelled ghost was standing on.
      if (selectedRef.current) {
        selectedRef.current = null; // the ghost must go this frame, not on the next render
        setSelected(null);
      } else {
        harvestingRef.current = Date.now(); // right-click harvests for as long as it is held
      }
    }
  };

  return (
    <main className="game">
      <header className="game-header">
        {/* The lobby code header is gone (ADR 0001) — it is on the lobby screen, where it is
            needed to share, and repeating it mid-match was scaffolding nobody asked for. */}
        <div className="signals" role="status" aria-live="polite">
          {state.status === "reconnecting" && (
            <span className="signal" role="img" aria-label="Reconnecting">
              <SpriteIcon subject={reconnectingIcon} px={24} />
            </span>
          )}
          {underAttack && (
            <span className="signal" role="img" aria-label="A structure is under attack">
              <SpriteIcon subject={warningIcon} px={24} />
            </span>
          )}
        </div>
      </header>
      {/* Focusable only in code: closing the menu hands focus back here, and it is never a stop on
          the way through the HUD with Tab. */}
      <canvas
        ref={canvasRef}
        className="arena"
        aria-label="Game arena"
        tabIndex={-1}
        onMouseMove={trackPointer}
        onMouseDown={onMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Escape's menu (#100). Leave is the whole of it — ADR 0001 grants nothing else a place
          here — and it acts on the click, with nothing to confirm. */}
      {menuOpen && (
        <dialog ref={menuRef} className="sheet game-menu" aria-label="Menu">
          <button ref={leaveRef} type="button" onClick={onLeave}>
            Leave
          </button>
        </dialog>
      )}
      {/* The bar stays and its written HP reading goes: #76 signals health with an ink bar, and
          ADR 0001 removed the label beside it. */}
      <div className="hud" role="status" aria-label="Health">
        <div className="hp-bar">
          <div
            className="hp-fill"
            style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
            data-low={hp <= 30}
          />
        </div>
      </div>
      {/* Metal, Energy and the rate's `metal / s` are the words the allowlist grants these readouts. */}
      <div className="banks" role="status" aria-label="Resources">
        {/* A button only so keyboard focus can reach the Metal-per-second reveal — the reveal itself
            is CSS, and the linter rejects `tabIndex` on a non-interactive element (#105). The span
            around the rate box is the aperture it is drawn out of: the box is wider than the readout,
            and this is what clips that overhang while the box is still level with it. */}
        <button type="button" className="bank bank-metal">
          <span className="bank-label">Metal</span>
          <strong>{metal}</strong>
          <span className="bank-reveal">
            <span className="bank-rate">
              <span className="bank-label">metal / s</span>
              <strong>{metalRate}</strong>
            </span>
          </span>
        </button>
        <span className="bank">
          <span className="bank-label">Energy</span>
          <strong>
            {power.consumption}/{power.generation}
          </strong>
        </span>
      </div>
      {/* A slot is its buildable's sprite, its Metal cost in a circle on the top-left corner, and
          its one-word name underneath (#98). The words and the numerals are an ADR 0001 exception,
          asked for explicitly and recorded in the allowlist — the number keys stay gone. */}
      <div className="build-bar" role="toolbar" aria-label="Buildables">
        {BUILD_SLOTS.map((kind, slot) => {
          const icon = SPRITES[kind];
          const spec = BUILDABLES[kind];
          return (
            <button
              key={kind}
              type="button"
              className="build-slot"
              aria-label={kind}
              aria-pressed={selected === kind}
              // A kind with no registry entry has not shipped: the slot shows, but is not usable.
              disabled={!spec}
              onClick={() => setSelected(selected === kind ? null : kind)}
            >
              {/* No spec, no circle: a kind that has not shipped has no cost to state, and an empty
                  circle would read as "free". */}
              {spec && <span className="build-cost">{costs[slot]}</span>}
              {icon && <SpriteIcon subject={icon} px={BUILD_ICON_PX} />}
              <span className="build-name">{BUILD_NAMES[kind]}</span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

function sizeBackingStore(
  canvas: HTMLCanvasElement,
  viewRef: { current: { w: number; h: number; dpr: number } },
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  viewRef.current = { w, h, dpr };
  applyBackingStore(canvas, w, h, dpr);
}

function resizeForDpr(
  canvas: HTMLCanvasElement,
  viewRef: { current: { w: number; h: number; dpr: number } },
  dpr: number,
): void {
  const { w, h } = viewRef.current;
  viewRef.current = { w, h, dpr };
  applyBackingStore(canvas, w, h, dpr);
}

function applyBackingStore(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
}

// What held right-click is harvesting this instant, or null if nothing is — a released button, a
// world not up yet, a corpse, or a cursor over anything that yields nothing. The request loop and
// the mining pin both read this one answer, so the pin can never outlast the harvest it follows.
function liveHarvest(
  world: ClientWorld | undefined,
  heldSince: number | null,
  pointer: Vec2,
  camera: Camera,
): HarvestTarget {
  if (!world || heldSince === null || world.isDead()) return null;
  const target = resolveHarvest(cursorTile(pointer, camera), world.ore, world.build);
  if (target?.kind !== "mine") return target;
  // `admitMine` refuses a report from further off than INTERACT_REACH (build.ts:209). Nothing here
  // reads that as the player's true reach — it is an anti-teleport bound — but a mine it provably
  // refuses is not a live harvest, and pinning on one would hold the player still banking nothing.
  const self = world.selfPos();
  return self && !withinReach(tileCenter(target.tile), self, INTERACT_REACH) ? null : target;
}

// The tile under the pointer. The camera maps CSS pixels to world units 1:1, so the pointer's
// world position is simply pointer + camera.
function cursorTile(pointer: Vec2, camera: Camera): Tile {
  return tileOf({ x: pointer.x + camera.x, y: pointer.y + camera.y });
}

function selfPos(players: { id: string; pos: Vec2 }[], selfId: string | undefined): Vec2 | null {
  return players.find((p) => p.id === selfId)?.pos ?? null;
}

function center(arena: Arena): Vec2 {
  return { x: arena.width / 2, y: arena.height / 2 };
}
