import type { Vec2 } from "../lobby/protocol";

// A relayed peer position stamped with its local arrival time. Peers are rendered from a
// short buffer of these, a fixed delay behind real time, so ~20 Hz updates read as motion.
export interface PosSample {
  t: number; // local arrival time (ms)
  pos: Vec2;
}

// LERP the two samples bracketing `renderTime`. Before the buffer starts, clamp to the
// oldest; past the newest, hold it — a gap from a missed or late packet freezes the peer
// at its last known position rather than extrapolating into a guess. `samples` must be
// ascending in `t`. Returns null only for an empty buffer.
export function interpolateAt(samples: PosSample[], renderTime: number): Vec2 | null {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (renderTime <= first.t) return { ...first.pos };
  if (renderTime >= last.t) return { ...last.pos };

  for (let i = 1; i < samples.length; i++) {
    const b = samples[i];
    if (b.t >= renderTime) {
      const a = samples[i - 1];
      const span = b.t - a.t;
      const f = span === 0 ? 0 : (renderTime - a.t) / span;
      return { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f };
    }
  }
  return { ...last.pos }; // unreachable given the bounds checks above
}
