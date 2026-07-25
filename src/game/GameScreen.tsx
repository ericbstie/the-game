import { useEffect, useRef, useState } from "react";
import type { LobbyState } from "../lobby/client";
import type { Arena, BuildableKind, MoveInput, Tile, Vec2 } from "../lobby/protocol";
import {
  BUILD_SLOTS,
  BUILDABLES,
  DEMOLISH_HOLD_MS,
  MINE_CADENCE_MS,
  placementError,
  resolveHarvest,
  tileOf,
} from "./build";
import { type Camera, computeCamera } from "./camera";
import { RESPAWN_DELAY_MS } from "./clientWorld";
import { type BuildGhost, drawWorld } from "./draw";
import { aimDir, keyToBuildSlot, keyToDirection, movesEqual, NO_MOVE } from "./input";
import { PLAYER_MAX_HP } from "./world";

const POS_SEND_MS = 50; // ~20 Hz position stream, independent of the render frame rate
const MAX_FRAME_MS = 100; // cap dt so a backgrounded tab doesn't teleport the avatar on resume

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
  const [selected, setSelected] = useState<BuildableKind | null>(null);
  const selectedRef = useRef(selected); // the render loop and the click handler read it un-stale
  const [hp, setHp] = useState(PLAYER_MAX_HP); // mirrored into React only to drive the HUD
  const [metal, setMetal] = useState(0); // the shared bank, mirrored into React for the HUD
  const [respawnIn, setRespawnIn] = useState(0); // seconds until respawn, shown while downed
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

  // Keyboard → held MoveInput, plus the build bar's 1–4 and Escape. Nothing is sent per key.
  useEffect(() => {
    const setHeld = (direction: keyof MoveInput, down: boolean) => {
      const next = { ...heldRef.current, [direction]: down };
      if (movesEqual(next, heldRef.current)) return; // only react to a real change
      heldRef.current = next;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const slot = keyToBuildSlot(e.key, BUILD_SLOTS.length);
      if (slot !== null) {
        setSelected(slot === "cancel" ? null : BUILD_SLOTS[slot]);
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
        if (!world.isDead()) world.stepSelf(dt, heldRef.current, Date.now()); // a corpse holds still
        world.updateHealth(Date.now()); // judge contact damage at the owner's true position
        const { w, h } = viewRef.current;
        const ctx = w > 0 && h > 0 ? canvas.getContext("2d") : null;
        if (ctx) {
          const snapshot = world.snapshot(Date.now());
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
          drawWorld(ctx, snapshot, { selfId: selfIdRef.current, camera, viewport, ghost });
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
      // Client-run respawn: after the delay, snap back to center at full HP.
      if (world.isDead()) {
        deadSince ??= now;
        const remaining = Math.max(0, RESPAWN_DELAY_MS - (now - deadSince));
        setRespawnIn(Math.ceil(remaining / 1000));
        if (remaining === 0) {
          world.reviveSelf();
          deadSince = null;
        }
      } else {
        deadSince = null;
      }
      const nextHp = world.hp();
      if (nextHp !== lastHp) {
        lastHp = nextHp;
        setHp(nextHp); // repaint the HUD (rare — only on a health change)
        onHealthRef.current(nextHp); // report it; hp <= 0 declares death, max declares the revive
      }
      setMetal(world.metal()); // React bails out when the whole-metal readout hasn't moved
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
      const world = worldRef.current;
      const heldSince = harvestingRef.current;
      if (heldSince === null || !world || world.isDead()) return;
      const tile = cursorTile(pointerRef.current, aimRef.current.camera);
      const target = resolveHarvest(tile, world.ore, world.build);
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
      if (kind) onBuildRef.current(kind, cursorTile(pointerRef.current, camera));
      else onAttackRef.current({ ...self }, aimDir(pointerRef.current, self, camera));
    } else if (e.button === 2) {
      harvestingRef.current = Date.now(); // right-click harvests for as long as it is held
    }
  };

  return (
    <main className="game">
      <header className="game-header">
        <span className="code">
          Lobby <strong>{state.code}</strong>
        </span>
        {state.status === "reconnecting" && (
          <span className="banner" role="status">
            Reconnecting…
          </span>
        )}
        <button type="button" onClick={onLeave}>
          Leave
        </button>
      </header>
      <canvas
        ref={canvasRef}
        className="arena"
        aria-label="Game arena"
        onMouseMove={trackPointer}
        onMouseDown={onMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="hud" role="status" aria-label="Health">
        <div className="hp-bar">
          <div
            className="hp-fill"
            style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
            data-low={hp <= 30}
          />
        </div>
        <span className="hp-label">
          {hp > 0 ? `HP ${hp}` : `Downed — respawning in ${respawnIn}…`}
        </span>
      </div>
      <div className="banks" role="status" aria-label="Resources">
        <span className="bank metal">Metal {metal}</span>
      </div>
      <div className="build-bar" role="toolbar" aria-label="Buildables">
        {BUILD_SLOTS.map((kind, i) => (
          <button
            key={kind}
            type="button"
            className="build-slot"
            aria-pressed={selected === kind}
            // A kind with no registry entry has not shipped: the slot shows, but is not usable.
            disabled={!BUILDABLES[kind]}
            onClick={() => setSelected(selected === kind ? null : kind)}
          >
            <span className="build-key">{i + 1}</span>
            <span className="build-name">{kind}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        Move with WASD or the arrow keys. Left-click to shoot. Hold right-click to mine metal ore —
        or to demolish a structure for some of its metal back. Press 1–4 to pick a buildable and
        left-click to place it; Escape cancels.
      </p>
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
