import { useEffect, useRef } from "react";
import type { LobbyState } from "../lobby/client";
import type { MoveInput, Vec2 } from "../lobby/protocol";
import { drawWorld } from "./draw";
import { keyToDirection, movesEqual, NO_MOVE } from "./input";
import { ARENA } from "./world";

const POS_SEND_MS = 50; // ~20 Hz position stream, independent of the render frame rate
const MAX_FRAME_MS = 100; // cap dt so a backgrounded tab doesn't teleport the avatar on resume

interface GameScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onPos: (pos: Vec2) => void;
}

// The in-match screen. The client owns its own Avatar now: a single render loop integrates
// it locally each frame from the held keys (zero input lag) and paints the world, while
// peers move from relayed positions applied to the same live world elsewhere. The owner's
// position is streamed out at a fixed ~20 Hz. Refs bridge React's render into the loop so a
// world swapped on reconnect and a changed callback are picked up without restarting it.
export function GameScreen({ state, onLeave, onPos }: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<MoveInput>(NO_MOVE);
  const worldRef = useRef(state.world);
  const selfIdRef = useRef(state.self?.id);
  const onPosRef = useRef(onPos);
  worldRef.current = state.world;
  selfIdRef.current = state.self?.id;
  onPosRef.current = onPos;

  // Keyboard → held MoveInput. It now drives the local self-sim; nothing is sent per key.
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

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      const world = worldRef.current;
      if (world) {
        world.stepSelf(dt, heldRef.current);
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) drawWorld(ctx, world.snapshot(), { selfId: selfIdRef.current });
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

  const arena = state.world?.snapshot().arena ?? ARENA;

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
        width={arena.width}
        height={arena.height}
        className="arena"
        aria-label="Game arena"
      />
      <p className="hint">Move with WASD or the arrow keys.</p>
    </main>
  );
}
