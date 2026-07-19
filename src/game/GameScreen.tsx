import { useEffect, useRef } from "react";
import type { LobbyState } from "../lobby/client";
import type { Arena, MoveInput, Vec2, Weapon } from "../lobby/protocol";
import { type Camera, computeCamera } from "./camera";
import { drawWorld } from "./draw";
import { aimDir, keyToDirection, movesEqual, NO_MOVE } from "./input";

const POS_SEND_MS = 50; // ~20 Hz position stream, independent of the render frame rate
const MAX_FRAME_MS = 100; // cap dt so a backgrounded tab doesn't teleport the avatar on resume

interface GameScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onPos: (pos: Vec2) => void;
  onAttack: (weapon: Weapon, pos: Vec2, dir: Vec2) => void;
}

// The in-match screen: a fullscreen camera that follows your Avatar through the giant box.
// A single render loop integrates the owner locally each frame (zero input lag), samples
// peers render-delay behind from their buffers, clamps the camera at the walls, culls
// off-screen entities, and paints via a DPR-correct transform (1 world unit = 1 CSS px,
// crisp on HiDPI). The owner's position streams out at a fixed ~20 Hz. Refs bridge React's
// render into the loop so a world swapped on reconnect and a changed callback are picked up
// without restarting it.
export function GameScreen({ state, onLeave, onPos, onAttack }: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<MoveInput>(NO_MOVE);
  const worldRef = useRef(state.world);
  const selfIdRef = useRef(state.self?.id);
  const onPosRef = useRef(onPos);
  const onAttackRef = useRef(onAttack);
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

  // Keyboard → held MoveInput. It drives the local self-sim; nothing is sent per key.
  useEffect(() => {
    const setHeld = (direction: keyof MoveInput, down: boolean) => {
      const next = { ...heldRef.current, [direction]: down };
      if (movesEqual(next, heldRef.current)) return; // only react to a real change
      heldRef.current = next;
    };
    const onKeyDown = (e: KeyboardEvent) => {
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
        world.stepSelf(dt, heldRef.current);
        const { w, h } = viewRef.current;
        const ctx = w > 0 && h > 0 ? canvas.getContext("2d") : null;
        if (ctx) {
          const snapshot = world.snapshot(Date.now());
          const self = selfPos(snapshot.players, selfIdRef.current) ?? center(world.arena);
          const viewport = { width: w, height: h };
          const camera = computeCamera(self, viewport, world.arena);
          aimRef.current = { camera, self }; // feed the attack handlers the live origin + camera
          ctx.setTransform(dpr, 0, 0, dpr, -camera.x * dpr, -camera.y * dpr);
          drawWorld(ctx, snapshot, { selfId: selfIdRef.current, camera, viewport });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const pos = worldRef.current?.selfPos();
      if (pos) onPosRef.current(pos);
    }, POS_SEND_MS);
    return () => clearInterval(timer);
  }, []);

  const trackPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const fire = (weapon: Weapon) => {
    const { camera, self } = aimRef.current;
    onAttackRef.current(weapon, { ...self }, aimDir(pointerRef.current, self, camera));
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    trackPointer(e);
    if (e.button === 0)
      fire("melee"); // left-click swings
    else if (e.button === 2) fire("ranged"); // right-click shoots
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
      <p className="hint">
        Move with WASD or the arrow keys. Left-click to swing, right-click to shoot.
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

function selfPos(players: { id: string; pos: Vec2 }[], selfId: string | undefined): Vec2 | null {
  return players.find((p) => p.id === selfId)?.pos ?? null;
}

function center(arena: Arena): Vec2 {
  return { x: arena.width / 2, y: arena.height / 2 };
}
