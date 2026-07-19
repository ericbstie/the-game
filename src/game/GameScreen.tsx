import { useEffect, useRef } from "react";
import type { LobbyState } from "../lobby/client";
import type { MoveInput } from "../lobby/protocol";
import { drawWorld } from "./draw";
import { keyToDirection, movesEqual, NO_MOVE } from "./input";
import { ARENA } from "./world";

interface GameScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onInput: (move: MoveInput) => void;
}

// The in-match screen: a canvas rendering the streamed world, plus keyboard capture.
// The server owns simulation — this only paints the latest snapshot and reports which
// keys are held. It repaints when a new frame arrives (state.world changes), so there
// is no client-side game loop to run.
export function GameScreen({ state, onLeave, onInput }: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<MoveInput>(NO_MOVE);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    const setHeld = (direction: keyof MoveInput, down: boolean) => {
      const next = { ...heldRef.current, [direction]: down };
      if (movesEqual(next, heldRef.current)) return; // only emit on a real change
      heldRef.current = next;
      onInputRef.current(next);
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
    const canvas = canvasRef.current;
    const world = state.world;
    if (!canvas || !world) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // no 2D backend (e.g. under the test DOM) — nothing to paint
    drawWorld(ctx, world, { selfId: state.self?.id });
  }, [state.world, state.self?.id]);

  const arena = state.world?.arena ?? ARENA;

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
