import { useEffect, useRef } from "react";
import type { SpriteSubject } from "./sheet";

// A sprite drawn into the HUD instead of into the world.
//
// `drawWorld` never sees the HUD, and the DOM cannot blit a `BakedSprite`, so the two icons #81
// puts in the HUD — the under-attack bell and the reconnecting broken link — and the buildable
// each build slot stands for all reach the screen through here.
//
// This deliberately does not go through `SpriteCache`. The cache exists to keep a bake off the
// hot path of a 60 Hz render loop that asks for hundreds of sprites a frame; a HUD icon is drawn
// once when it mounts and never again, so caching it would be bookkeeping for no saving.
//
// `px` is the size to draw at, which is usually *not* the subject's own box: a generator's box is
// 75 and its build slot is 26. The subject still draws in its own units and the extra scale rides
// on the transform, so nothing about the sprite has to know it is being shown small.
interface SpriteIconProps {
  subject: SpriteSubject;
  px: number;
  facing?: number;
  frame?: number;
  className?: string;
}

export function SpriteIcon({ subject, px, facing = 0, frame = 0, className }: SpriteIconProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Baked at `px × dpr` for the same reason every world sprite is (#77 §5): the CSS box is `px`,
    // so anything baked smaller is upscaled by the browser and reads soft.
    const dpr = window.devicePixelRatio || 1;
    const pixels = Math.round(px * dpr);
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // no 2d context under `bun test`; the HUD renders without its icons
    const scale = pixels / subject.size;
    ctx.scale(scale, scale);
    subject.draw(ctx, subject.size, facing, frame);
  }, [subject, px, facing, frame]);

  // No accessible name of its own: every icon here replaces text ADR 0001 removed, and the element
  // that wraps it — a `role="img"` signal, or the build-slot button — carries the name instead. An
  // empty canvas contributes no text to the tree, so it stays silent without being hidden.
  return <canvas ref={ref} className={className} style={{ width: px, height: px }} />;
}
