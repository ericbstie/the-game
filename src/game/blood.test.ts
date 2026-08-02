import { describe, expect, test } from "bun:test";
import type { RenderedEnemy, Vec2 } from "../lobby/protocol";
import {
  BLOOD_CAP,
  BLOOD_FADE_MS,
  DRIP_SPACING,
  DROP_RADIUS,
  freshBlood,
  STAIN_RADIUS,
  stepBlood,
} from "./blood";
import type { Camera, Viewport } from "./camera";
import { BLOODLING_RADIUS, BLOODLING_SPEED } from "./enemies";

const CAM: Camera = { x: 0, y: 0 };
const VIEW: Viewport = { width: 800, height: 600 };
const AT: Vec2 = { x: 400, y: 300 };

const bloodling = (id: string, pos: Vec2): RenderedEnemy => ({
  id,
  kind: "bloodling",
  pos,
  radius: BLOODLING_RADIUS,
  hp: 15,
  facing: 0,
  frame: 0,
  flashing: false,
});
const grunt = (id: string, pos: Vec2): RenderedEnemy => ({ ...bloodling(id, pos), kind: "grunt" });
const east = (from: Vec2, by: number): Vec2 => ({ x: from.x + by, y: from.y });

describe("blood decals (#140)", () => {
  test("a bloodling standing still leaves nothing, however long it stands there", () => {
    const blood = freshBlood();
    for (let t = 0; t < 10; t++) stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, t * 16);
    expect(stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 200)).toEqual([]);
  });

  test("it drips once per body length walked, wherever it got to", () => {
    const blood = freshBlood();
    stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 0);
    expect(stepBlood(blood, [bloodling("b1", east(AT, DRIP_SPACING - 1))], CAM, VIEW, 16)).toEqual(
      [],
    );
    const marks = stepBlood(blood, [bloodling("b1", east(AT, DRIP_SPACING))], CAM, VIEW, 32);
    expect(marks).toEqual([{ pos: east(AT, DRIP_SPACING), at: 32, radius: DROP_RADIUS }]);
  });

  // The trail is a function of the ground covered, not of how often anybody looked: a 144 Hz client
  // and a 30 Hz one have to lay the same marks, or the same fight bleeds differently on two screens.
  test("the trail is the distance walked, not the frames drawn", () => {
    const walk = (steps: number) => {
      const blood = freshBlood();
      const stride = (DRIP_SPACING * 4) / steps;
      for (let i = 0; i <= steps; i++) {
        stepBlood(blood, [bloodling("b1", east(AT, i * stride))], CAM, VIEW, i);
      }
      return blood.live.length;
    };
    expect(walk(4)).toBe(4);
    expect(walk(16)).toBe(4);
    expect(walk(64)).toBe(4);
  });

  // A tab that was not drawing, or a frame that took a second: the distance owes a dozen drops and
  // the bound is what stops them arriving in one place.
  test("one step lays one drop however far it jumped", () => {
    const blood = freshBlood();
    const from = { x: 40, y: 300 };
    stepBlood(blood, [bloodling("b1", from)], CAM, VIEW, 0);
    // Twenty spacings in one step, and still inside the viewport so the cull is not what refuses it.
    const marks = stepBlood(blood, [bloodling("b1", east(from, DRIP_SPACING * 20))], CAM, VIEW, 16);
    expect(marks).toHaveLength(1);
  });

  // A splat and not a dot: the blot itself stands where the creature did, and the lobes thrown off
  // it are smaller, wider than a drip, and all of one age so the whole stain dries together.
  test("one that goes off leaves a splat where it stood, every lobe wider than a drip", () => {
    const blood = freshBlood();
    stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 0);
    const splat = stepBlood(blood, [], CAM, VIEW, 16);
    expect(splat.length).toBeGreaterThan(1);
    expect(splat).toContainEqual({ pos: AT, at: 16, radius: STAIN_RADIUS });
    expect(splat.every((m) => m.at === 16 && m.radius > DROP_RADIUS)).toBe(true);
    for (const lobe of splat) {
      expect(Math.hypot(lobe.pos.x - AT.x, lobe.pos.y - AT.y)).toBeLessThan(STAIN_RADIUS * 2);
    }
  });

  // Two of them do not stamp the same drawing twice: the lobes are turned by where the blow fell.
  test("no two stains are the same splat", () => {
    const splat = (at: Vec2) => {
      const blood = freshBlood();
      stepBlood(blood, [bloodling("b1", at)], CAM, VIEW, 0);
      return stepBlood(blood, [], CAM, VIEW, 16).map((m) => [m.pos.x - at.x, m.pos.y - at.y]);
    };
    expect(splat(AT)).not.toEqual(splat({ x: AT.x + 111, y: AT.y + 37 }));
  });

  test("the stain outlives the creature — it is not hung off a record the death deleted", () => {
    const blood = freshBlood();
    stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 0);
    const splat = stepBlood(blood, [], CAM, VIEW, 16).length;
    expect(stepBlood(blood, [], CAM, VIEW, BLOOD_FADE_MS - 1)).toHaveLength(splat);
  });

  test("nothing else bleeds: a grunt walks and dies and leaves no mark", () => {
    const blood = freshBlood();
    stepBlood(blood, [grunt("g1", AT)], CAM, VIEW, 0);
    stepBlood(blood, [grunt("g1", east(AT, DRIP_SPACING * 3))], CAM, VIEW, 16);
    expect(stepBlood(blood, [], CAM, VIEW, 32)).toEqual([]);
  });

  test("a mark fades out of the list once its life has run", () => {
    const blood = freshBlood();
    // It stands still after the one drip, so nothing else is laid and nothing dies: the only thing
    // this asserts is that the mark's own life ran out.
    const standing = [bloodling("b1", east(AT, DRIP_SPACING))];
    stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 0);
    stepBlood(blood, standing, CAM, VIEW, 0);
    expect(stepBlood(blood, standing, CAM, VIEW, BLOOD_FADE_MS - 1)).toHaveLength(1);
    expect(stepBlood(blood, standing, CAM, VIEW, BLOOD_FADE_MS)).toEqual([]);
  });

  // The `floats.ts` stance, and the whole reason this layer is bounded at all: a bloodling bleeds
  // across a 31,200² arena and the camera is over 800 × 600 of it.
  test("what nobody was looking at is not owed a mark", () => {
    const blood = freshBlood();
    const away = { x: 20_000, y: 20_000 };
    stepBlood(blood, [bloodling("b1", away)], CAM, VIEW, 0);
    expect(stepBlood(blood, [bloodling("b1", east(away, DRIP_SPACING))], CAM, VIEW, 16)).toEqual(
      [],
    );
    expect(stepBlood(blood, [], CAM, VIEW, 32)).toEqual([]); // and no stain when it goes off
  });

  test("the list is capped, and it is the freshest marks that survive", () => {
    const blood = freshBlood();
    let now = 0;
    let x = 0;
    // One bloodling walking a long way is enough: the cap has to hold whatever produces the marks.
    for (let i = 0; i < BLOOD_CAP * 2; i++) {
      x += DRIP_SPACING;
      stepBlood(blood, [bloodling("b1", { x: x % VIEW.width, y: 300 })], CAM, VIEW, now++);
    }
    const marks = stepBlood(blood, [bloodling("b1", { x: 1, y: 300 })], CAM, VIEW, now);
    expect(marks).toHaveLength(BLOOD_CAP);
    expect(marks[marks.length - 1].at).toBeGreaterThan(marks[0].at); // oldest first, oldest dropped
    expect(marks[0].at).toBeGreaterThan(BLOOD_CAP / 2);
  });

  test("the fade is what usually bounds it: a whole squad's worth of trails fits inside the cap", () => {
    // Six bloodlings on one screen is the case the fade is chosen against — see the module header.
    const blood = freshBlood();
    const frames = Math.floor(BLOOD_FADE_MS / 16);
    for (let f = 0; f < frames; f++) {
      const walked = (BLOODLING_SPEED * f * 16) / 1_000;
      const charging = [0, 1, 2, 3, 4, 5].map((i) =>
        bloodling(`b${i}`, { x: 20 + (walked % 700), y: 60 + i * 80 }),
      );
      stepBlood(blood, charging, CAM, VIEW, f * 16);
    }
    expect(blood.live.length).toBeLessThan(BLOOD_CAP);
  });

  test("a bloodling only just seen drips nothing until it has walked", () => {
    const blood = freshBlood();
    expect(stepBlood(blood, [bloodling("b1", AT)], CAM, VIEW, 0)).toEqual([]);
  });
});
