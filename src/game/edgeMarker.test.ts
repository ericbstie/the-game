import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../lobby/protocol";
import type { Camera, Viewport } from "./camera";
import {
  edgeMarker,
  MARKER_FADE_UNITS,
  MARKER_INSET,
  MARKER_MIN_ALPHA,
  markerPoints,
} from "./edgeMarker";

const viewport: Viewport = { width: 800, height: 600 };
const camera: Camera = { x: 1000, y: 1000 };
const centre = { x: camera.x + viewport.width / 2, y: camera.y + viewport.height / 2 };
const halfW = viewport.width / 2 - MARKER_INSET;
const halfH = viewport.height / 2 - MARKER_INSET;

describe("where an off-screen teammate's marker sits", () => {
  test("due east lands on the right inset edge, level with the centre", () => {
    const marker = edgeMarker({ x: centre.x + 9000, y: centre.y }, camera, viewport);
    expect(marker.x).toBeCloseTo(centre.x + halfW, 6);
    expect(marker.y).toBeCloseTo(centre.y, 6);
  });

  test("due north lands on the top inset edge", () => {
    const marker = edgeMarker({ x: centre.x, y: centre.y - 9000 }, camera, viewport);
    expect(marker.x).toBeCloseTo(centre.x, 6);
    expect(marker.y).toBeCloseTo(centre.y - halfH, 6);
  });

  test("a diagonal peer leaves through whichever edge its ray reaches first", () => {
    // Shallow: 10,000 east for 1,000 south leaves through the east edge well short of the corner.
    const marker = edgeMarker({ x: centre.x + 10_000, y: centre.y + 1000 }, camera, viewport);
    expect(marker.x).toBeCloseTo(centre.x + halfW, 6);
    expect(marker.y).toBeCloseTo(centre.y + halfW / 10, 6);
  });

  test("the bearing is the angle from the viewport centre to the peer", () => {
    const peer = { x: centre.x - 4000, y: centre.y + 3000 };
    const marker = edgeMarker(peer, camera, viewport);
    expect(marker.angle).toBeCloseTo(Math.atan2(3000, -4000), 10);
  });
});

describe("how far away an arrow reads as", () => {
  test("a teammate just past the viewport edge is fully opaque", () => {
    const marker = edgeMarker(
      { x: centre.x + viewport.width / 2 + 40, y: centre.y },
      camera,
      viewport,
    );
    expect(marker.alpha).toBeGreaterThan(0.99);
    expect(marker.alpha).toBeLessThanOrEqual(1);
  });

  test("the fade bottoms out at MARKER_FADE_UNITS and never goes below it", () => {
    const at = (away: number) =>
      edgeMarker({ x: centre.x + halfW + away, y: centre.y }, camera, viewport).alpha;
    expect(at(MARKER_FADE_UNITS)).toBeCloseTo(MARKER_MIN_ALPHA, 10);
    expect(at(MARKER_FADE_UNITS * 2)).toBeCloseTo(MARKER_MIN_ALPHA, 10);
    expect(at(MARKER_FADE_UNITS * 100)).toBeCloseTo(MARKER_MIN_ALPHA, 10);
  });

  test("it fades monotonically over that span, so nearer always reads brighter", () => {
    const at = (away: number) =>
      edgeMarker({ x: centre.x + halfW + away, y: centre.y }, camera, viewport).alpha;
    expect(at(1000)).toBeGreaterThan(at(5000));
    expect(at(5000)).toBeGreaterThan(at(15_000));
    expect(at(MARKER_FADE_UNITS / 2)).toBeCloseTo(1 - (1 - MARKER_MIN_ALPHA) / 2, 10);
  });
});

describe("the arrow itself", () => {
  const bearings = Array.from({ length: 64 }, (_, i) => (i / 64) * Math.PI * 2);
  const peerAt = (angle: number): Vec2 => ({
    x: centre.x + Math.cos(angle) * 20_000,
    y: centre.y + Math.sin(angle) * 20_000,
  });

  test("every point of it stays inside the viewport rect, at every bearing", () => {
    for (const angle of bearings) {
      const points = markerPoints(edgeMarker(peerAt(angle), camera, viewport));
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(camera.x);
        expect(p.x).toBeLessThanOrEqual(camera.x + viewport.width);
        expect(p.y).toBeGreaterThanOrEqual(camera.y);
        expect(p.y).toBeLessThanOrEqual(camera.y + viewport.height);
      }
    }
  });

  test("the tip leads — no other point of it is nearer the teammate", () => {
    for (const angle of bearings) {
      const peer = peerAt(angle);
      const points = markerPoints(edgeMarker(peer, camera, viewport));
      const away = points.map((p) => Math.hypot(peer.x - p.x, peer.y - p.y));
      expect(away[0]).toBe(Math.min(...away));
    }
  });

  test("it is a closed four-point dart, not a bare triangle", () => {
    expect(markerPoints(edgeMarker(peerAt(0), camera, viewport))).toHaveLength(4);
  });
});
