import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LobbyState } from "../lobby/client";
import type { BuildableKind, MoveInput, Tile, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  BULLET_COST,
  type BuildableSpec,
  FORGE_MS,
  footprintCenter,
  INTERACT_REACH,
  insertStructure,
  MINER_TRICKLE,
  placeStructure,
  TILE,
  tileKey,
} from "./build";
import { ClientWorld } from "./clientWorld";
import { SHAKE_MS } from "./damageFx";
import { GRUNT_HP, GRUNT_RADIUS, RANGED_CADENCE_MS } from "./enemies";
import { GameScreen, REFUSAL_MS } from "./GameScreen";
import { ORE_HARVEST_MS, STRUCTURE_HARVEST_MS } from "./harvest";
import { aimDir, GUN_TOGGLE_KEY, MINIMAP_ZOOM_KEY, movesEqual, NO_MOVE } from "./input";
import { MINIMAP_COVERAGE_CLOSE_U, MINIMAP_COVERAGE_U, MINIMAP_SIZE } from "./minimap";
import { ARENA, PLAYER_RADIUS } from "./world";
import { DEFAULT_WORLD_SETTINGS } from "./worldSettings";
import { ZOOM_SETTLE_MS } from "./zoom";

const SPAWN = { x: 400, y: 300 };
const init: WorldInit = {
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [{ id: "me", slot: 1, name: "Me", pos: SPAWN }],
  oreSeed: 1,
  nestSeed: 1,
  settings: DEFAULT_WORLD_SETTINGS,
};

// Real elapsed time rather than a mocked clock: happy-dom installs its own `Date`, which shadows
// the one `setSystemTime` patches, so the component would never see a frozen clock. Timers only
// ever overshoot, so every gap below is asserted on rather than assumed — a slow machine must fail
// the test rather than quietly stop exercising it.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POS_SEND_MS = 50; // the HUD mirror's cadence, matching the component's own constant

// A world stocked with bullets. Shooting spends one from the squad's pool (#102), so every test
// below that is about the trigger rather than about the pool starts with more than it can use.
function armed(initialHp?: number): ClientWorld {
  const world = new ClientWorld(init, "me", initialHp);
  world.build.ammo.bullets = 999;
  return world;
}

// A live match, returning the arena canvas. Every callback defaults to a no-op, so a test names
// only the one it is watching.
function renderMatch(
  handlers: Partial<Omit<React.ComponentProps<typeof GameScreen>, "state">> = {},
  world = armed(),
): HTMLElement {
  const state: LobbyState = {
    status: "lobby",
    code: "ABCD",
    self: { id: "me", token: "secret", slot: 1 },
    world,
  };
  render(
    <GameScreen
      state={state}
      onLeave={() => {}}
      onPos={() => {}}
      onAttack={() => {}}
      onHealth={() => {}}
      onMine={() => {}}
      onBuild={() => {}}
      onDemolish={() => {}}
      onForge={() => {}}
      {...handlers}
    />,
  );
  return screen.getByLabelText("Game arena");
}

// Equip the gun (#120). Left-click shoots only with it up, so every test about the trigger presses
// this first — you spawn with it stowed and left-click mining instead.
const equipGun = () => fireEvent.keyDown(window, { key: GUN_TOGGLE_KEY });

// A live match with the gun up and nothing selected on the build bar, so left-click means shoot.
function inMatch(onAttack: () => void, world = armed()): HTMLElement {
  const canvas = renderMatch({ onAttack }, world);
  equipGun();
  return canvas;
}

// The cursor sits at the canvas origin under happy-dom (every rect is zero and the camera never
// leaves 0,0), so this is the one tile a test can put something harvestable on.
const CURSOR_TILE = { tx: 0, ty: 0 };

// Every MoveInput the render loop stepped the avatar with, newest last.
function recordMoves(world: ClientWorld): MoveInput[] {
  const moves: MoveInput[] = [];
  const stepSelf = world.stepSelf.bind(world);
  world.stepSelf = (dt, input, now) => {
    moves.push(input);
    stepSelf(dt, input, now);
  };
  return moves;
}

// Let real time pass with React watching: the HUD's 20 Hz interval keeps setting state while a
// test waits, and once the component has re-rendered once React wants those inside `act`.
const settle = (ms: number) => act(async () => await sleep(ms));

const nextFrames = () => settle(60);

// Long enough for one whole harvest to come out of the ground (#130), plus room for the render
// loop to be late: progress is spent from real frame deltas, so a starved loop credits a little
// less than the wall clock says. Every "nothing was reported" below waits one of these out, so no
// such assertion can pass merely by being asked before the harvest could have finished.
const HARVEST_WINDOW = ORE_HARVEST_MS + 400;
const DEMOLISH_WINDOW = STRUCTURE_HARVEST_MS + 400;

afterEach(cleanup);

// #85: a rendered shot must never imply damage the server did not apply. Movement and mining were
// already gated on death; shooting was not, so a corpse could click, draw its own line, and have
// the attack admitted — the server's position check passes, because a dead player has not moved.
describe("#85: a downed player cannot shoot", () => {
  test("a click while dead is not sent", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack, armed(0));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(0);
  });

  test("and being dead does not consume the cadence, so the first shot back up lands", async () => {
    const onAttack = mock(() => {});
    const world = armed(0);
    const canvas = inMatch(onAttack, world);
    fireEvent.mouseDown(canvas, { button: 0 }); // refused: dead
    world.reviveSelf();
    fireEvent.mouseDown(canvas, { button: 0 }); // back up, and not made to wait a cadence
    expect(onAttack).toHaveBeenCalledTimes(1);
    await sleep(RANGED_CADENCE_MS + 20);
  });

  test("a living player is unaffected", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });
});

describe("M5-I5: the client holds itself to the weapon's cadence before firing", () => {
  test("a second click inside the cadence is not sent — the server would refuse it anyway", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("a click once the cadence has elapsed is sent", async () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    await sleep(RANGED_CADENCE_MS + 20);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(2);
  });

  test("a refused click does not push the window out — the cadence is not restarted by it", async () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    // Refused. If it wrongly reset the clock, the third click below lands inside its window and
    // the count stays at 2 — which is why each click is asserted rather than only the total.
    await sleep(RANGED_CADENCE_MS / 2);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    await sleep(RANGED_CADENCE_MS / 2 + 25);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(2);
  });
});

// #103: left-click became a hold. One shot leaves per `RANGED_CADENCE_MS` for as long as the
// button is down, aimed wherever the pointer is at the moment each one goes.
describe("#103: holding left-click auto-fires at one shot per cadence", () => {
  type Shot = { at: number; pos: Vec2; dir: Vec2 };

  // Press and hold the trigger, collecting every shot the component sent with the instant it left.
  // The button stays down until a test releases it.
  function holdFire(world = armed()) {
    const shots: Shot[] = [];
    const onAttack = (pos: Vec2, dir: Vec2) => shots.push({ at: Date.now(), pos, dir });
    const canvas = renderMatch({ onAttack }, world);
    equipGun(); // the trigger is left-click's job only with the gun up (#120)
    const pressedAt = Date.now();
    fireEvent.mouseDown(canvas, { button: 0 });
    return { canvas, shots, pressedAt };
  }

  // Six cadences: the hold the ticket counts six shots over.
  const HOLD_MS = 6 * RANGED_CADENCE_MS;

  test("a six-cadence hold sends exactly six shots", async () => {
    const { shots, pressedAt } = holdFire();
    await settle(HOLD_MS + RANGED_CADENCE_MS / 2); // held past the window, so a stall reads as one
    fireEvent.mouseUp(window);
    // Counted from the press rather than from the first shot's own timestamp, which is read a
    // moment after the clock the cadence was charged against. That skew is under a millisecond, but
    // the seventh shot falls exactly on the far edge of the window, and it is enough to pull it in.
    // The press provably precedes every shot, so the edge is exact in the one direction that counts.
    expect(shots.filter((s) => s.at - pressedAt < HOLD_MS)).toHaveLength(6);
  });

  test("no two shots of a hold are closer than the floor the server admits on", async () => {
    const { shots } = holdFire();
    await settle(3 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots.length).toBeGreaterThan(2);
    // `RANGED_CADENCE_MS` is `admitAttack`'s own floor, imported rather than restated, so this is
    // the client held to the very number that would refuse it — a refusal being a line drawn for
    // damage nobody took (#85). The millisecond of slack is the harness's, not the client's: each
    // timestamp is taken after the clock the shot was charged against, never the clock itself. It
    // still catches what matters, since a trigger paced by counting frames drifts by tens of
    // milliseconds rather than one.
    const OBSERVED_SKEW_MS = 1;
    const gaps = shots.slice(1).map((s, i) => s.at - (shots[i]?.at ?? 0));
    expect(gaps.filter((gap) => gap < RANGED_CADENCE_MS - OBSERVED_SKEW_MS)).toEqual([]);
  });

  test("moving the pointer mid-hold re-aims the next shot", async () => {
    const { canvas, shots } = holdFire();
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 400 });
    await settle(RANGED_CADENCE_MS + 60);
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(2);
    expect(shots[1]?.dir).not.toEqual(shots[0]?.dir as Vec2);
  });

  test("releasing the button stops the fire", async () => {
    const { shots } = holdFire();
    fireEvent.mouseUp(window);
    await settle(2 * RANGED_CADENCE_MS);
    expect(shots).toHaveLength(1);
  });

  test("blur stops the fire, so a button let go off-canvas does not hold the trigger", async () => {
    const { shots } = holdFire();
    fireEvent.blur(window);
    await settle(2 * RANGED_CADENCE_MS);
    expect(shots).toHaveLength(1);
  });

  test("opening the Escape menu stops the fire, and none goes into it (#100)", async () => {
    const { shots } = holdFire();
    fireEvent.keyDown(window, { key: "Escape" });
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(1);
  });

  test("dying mid-hold stops the fire", async () => {
    const world = armed();
    const { shots } = holdFire(world);
    world.applyPeerHealth("me", 0, 1);
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(1); // the one that left before it went down
  });

  test("a dead player fires nothing while the button is held", async () => {
    const world = armed(0);
    const { shots } = holdFire(world);
    await settle(3 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toEqual([]);
  });

  test("standing up under a still-held button fires no free shot", async () => {
    const world = armed(0);
    const { shots } = holdFire(world);
    await settle(RANGED_CADENCE_MS);
    world.reviveSelf();
    // The elapsed gate is satisfied the instant this comes back — `RESPAWN_DELAY_MS` is forty
    // cadences — so anything still armed would fire on the very next frame with no new input.
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toEqual([]);
  });

  test("firing again after a respawn takes a fresh press", async () => {
    const world = armed(0);
    const { canvas, shots } = holdFire(world);
    world.reviveSelf();
    await settle(RANGED_CADENCE_MS);
    fireEvent.mouseDown(canvas, { button: 0 });
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(1);
  });

  test("selecting a buildable mid-hold stops the fire and places nothing on its own", async () => {
    const onBuild = mock(() => {});
    const shots: Shot[] = [];
    const onAttack = (pos: Vec2, dir: Vec2) => shots.push({ at: Date.now(), pos, dir });
    const canvas = renderMatch({ onBuild, onAttack });
    equipGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(shots).toHaveLength(1);
    fireEvent.keyDown(window, { key: "1" }); // the build bar takes the button mid-hold
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(1);
    expect(onBuild).not.toHaveBeenCalled(); // and the hold does not place what it just selected
  });

  test("a stalled frame delays the next shot rather than banking the ones it spanned", async () => {
    const { shots } = holdFire();
    const stallUntil = Date.now() + 3 * RANGED_CADENCE_MS;
    // Block the loop outright, which is what a frame long enough to skip whole cadences does to it.
    // A trigger counting ticks, or paying down an accumulator, would let the backlog out at once.
    while (Date.now() < stallUntil) {
      /* spin */
    }
    await nextFrames();
    fireEvent.mouseUp(window);
    expect(shots).toHaveLength(2); // the stall costs one shot, not the three it covered
  });

  test("with a buildable selected, holding left-click places and never fires", async () => {
    const onBuild = mock(() => {});
    const shots: Shot[] = [];
    const onAttack = (pos: Vec2, dir: Vec2) => shots.push({ at: Date.now(), pos, dir });
    // Metal in the bank and ore under the cursor, because a placement the ghost paints red is one
    // the drag refuses to send (#104) — a squad with nothing banked would place nothing here and
    // the "never fires" half would pass for the wrong reason.
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    world.build.bank.metal = 1_000;
    const canvas = renderMatch({ onBuild, onAttack }, world);
    equipGun(); // and the bar still outranks the gun (#120)
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toEqual([]);
    // Once: the cursor never left its tile. The run a moving cursor lays is #104's own describe.
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});

// #120: the gun. `g` equips and stows it, and that is what left-click means — the trigger with the
// gun up, the pick with it down. A buildable on the bar outranks both. Right-click keeps demolish
// and the build bar's cancel, and mines nothing.
describe("#120: the gun decides what left-click does", () => {
  // Metal ore under the cursor is what left-click needs to have anything to mine.
  const overOre = (world = armed()) => {
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    return world;
  };
  const toggleGun = (init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(window, { key: GUN_TOGGLE_KEY, ...init });

  // Every job left-click has, watched together — every test here is about which of them a press
  // does, so none is ever asserted without the others.
  //
  // Mining reports nothing until a whole Metal is out of the ground (#130), so *which* job a held
  // button is doing is read off the pin the mine imposes (#109): a mine in progress is exactly a
  // frame stepped with `NO_MOVE` while a direction is held, and that answer lands on the next frame
  // rather than a harvest later. `onMine` is still watched, and is what says a harvest ran all the
  // way to zero — asserted over a window longer than one, so "nothing was reported" cannot pass by
  // being asked too early.
  function heldJobs(world = overOre()) {
    const onMine = mock(() => {});
    const onAttack = mock(() => {});
    const onBuild = mock(() => {});
    const moves = recordMoves(world);
    const canvas = renderMatch({ onMine, onAttack, onBuild }, world);
    fireEvent.keyDown(window, { key: "w" }); // held for the whole test, so the pin is readable
    const mining = () => {
      const last = moves.at(-1);
      return last !== undefined && movesEqual(last, NO_MOVE);
    };
    return { canvas, onMine, onAttack, onBuild, world, mining };
  }

  test("the gun starts stowed, so left-click mines and fires nothing", async () => {
    const { canvas, onMine, onAttack, mining } = heldJobs();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(true);
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).toHaveBeenCalledWith(CURSOR_TILE); // and the tile came all the way out
    expect(onAttack).not.toHaveBeenCalled();
  });

  test("with the gun equipped left-click fires and mines nothing", async () => {
    const { canvas, onMine, onAttack, mining } = heldJobs();
    toggleGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onAttack).toHaveBeenCalled();
    expect(onMine).not.toHaveBeenCalled();
  });

  test("`g` again stows it, and left-click is back to mining", async () => {
    const { canvas, onAttack, mining } = heldJobs();
    toggleGun();
    toggleGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(true);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onAttack).not.toHaveBeenCalled();
  });

  // The OS repeats a held key at ~30 Hz. A toggle stepped by each repeat would flap the gun thirty
  // times a second and land on whichever side the key happened to come up on — the same hole #110's
  // zoom closed. happy-dom does not synthesise native repeat, so this drives the flag the browser
  // sets on one.
  test("a repeat of a held `g` toggles nothing", async () => {
    const { canvas, onMine, onAttack, mining } = heldJobs();
    toggleGun();
    // An odd number of repeats, so a toggle that answered to them would land on the *other* side
    // rather than back where the one real press left it — the count is what makes this discriminate.
    toggleGun({ repeat: true });
    toggleGun({ repeat: true });
    toggleGun({ repeat: true });
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onAttack).toHaveBeenCalled(); // still equipped, as one press left it
    expect(onMine).not.toHaveBeenCalled();
  });

  test("a buildable on the bar outranks the stowed gun: left-click builds and mines nothing", async () => {
    const world = overOre();
    world.build.bank.metal = 1_000;
    const { canvas, onBuild, onMine, mining } = heldJobs(world);
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onMine).not.toHaveBeenCalled();
  });

  test("a buildable outranks the equipped gun too: left-click builds and fires nothing", async () => {
    const world = overOre();
    world.build.bank.metal = 1_000;
    const { canvas, onBuild, onAttack } = heldJobs(world);
    toggleGun();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    fireEvent.mouseUp(window, { button: 0 });
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onAttack).not.toHaveBeenCalled();
  });

  // A press over a full build bar latches a run and nothing else, so there is no second hold left
  // armed behind it. Taking the bar away mid-drag is what makes that visible: the run ends, and
  // left-click means nothing again until it is pressed again.
  test("a press that starts a run arms no hold behind it, so clearing the bar mines nothing", async () => {
    const world = overOre();
    world.build.bank.metal = 1_000;
    const { canvas, onMine, mining } = heldJobs(world);
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.mouseDown(canvas, { button: 0 });
    fireEvent.mouseDown(canvas, { button: 2 }); // right-click takes the ghost away, and the run
    await nextFrames();
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).not.toHaveBeenCalled();
  });

  // The mirror of #103's "selecting a buildable mid-hold stops the fire": the bar outranks the gun
  // in both states, so it must outrank it whether it was taken before the press or under it.
  test("selecting a buildable mid-hold stops the mining and places nothing on its own", async () => {
    const world = overOre();
    world.build.bank.metal = 1_000;
    const { canvas, onBuild, onMine, mining } = heldJobs(world);
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(true); // mining was really running when the bar was taken
    fireEvent.keyDown(window, { key: "1" });
    await settle(HARVEST_WINDOW); // longer than the harvest it interrupted
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).not.toHaveBeenCalled(); // the progress went with the selection
    expect(onBuild).not.toHaveBeenCalled(); // and the hold does not place what it just selected
  });

  // The half of the ticket a latched press cannot do: the button never comes up, and what it is
  // doing changes under it.
  test("`g` under a held button stops the fire and starts mining on the spot", async () => {
    const { canvas, onMine, onAttack, mining } = heldJobs();
    toggleGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(2 * RANGED_CADENCE_MS);
    const fired = onAttack.mock.calls.length;
    expect(fired).toBeGreaterThan(0); // the fire was really running when the gun went down
    toggleGun();
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    expect(mining()).toBe(true);
    expect(onMine).toHaveBeenCalledWith(CURSOR_TILE); // a harvest started and finished under the hold
    expect(onAttack).toHaveBeenCalledTimes(fired); // and not one shot more
  });

  test("`g` under a held button stops the mining and starts the fire on the spot", async () => {
    const { canvas, onMine, onAttack, mining } = heldJobs();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(true); // mining was really running when the gun came up
    toggleGun();
    await settle(HARVEST_WINDOW); // longer than the harvest it interrupted
    fireEvent.mouseUp(window, { button: 0 });
    expect(onAttack).toHaveBeenCalled();
    expect(mining()).toBe(false);
    expect(onMine).not.toHaveBeenCalled(); // and the interrupted progress earned nothing
  });

  // "Provided the cursor is over something valid for the new action" — and the hold is not spent by
  // failing that test. Nothing is latched at the press, so the switch is simply asked again on the
  // next frame, and the frame that finds ore under the cursor is the one that starts mining.
  test("switching onto nothing minable asks for nothing, and takes the ore up when it arrives", async () => {
    const world = armed(); // bare ground under the cursor: no ore anywhere near it
    const { canvas, onMine, mining } = heldJobs(world);
    toggleGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    toggleGun(); // the gun goes down over ground that yields nothing
    await nextFrames();
    expect(mining()).toBe(false);
    world.ore.set(tileKey(CURSOR_TILE), "metal"); // and now there is something there
    await nextFrames();
    expect(mining()).toBe(true); // with no second press
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).toHaveBeenCalledWith(CURSOR_TILE);
  });

  // #104's run is the one of the three that *is* latched at the press, so the gun must not disturb
  // it: the ticket puts the build bar above the gun in both states, which means a drag crossing an
  // `g` is still the same drag.
  test("`g` mid-drag neither ends the run nor fires into it", async () => {
    const world = armed();
    world.build.bank.metal = 100_000;
    const asked: Tile[] = [];
    const onAttack = mock(() => {});
    const canvas = renderMatch({ onBuild: (_k, tile) => asked.push(tile), onAttack }, world);
    fireEvent.keyDown(window, { key: "2" }); // wall
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 19 * TILE, clientY: 0 });
    await settle(3 * BUILD_CADENCE_MS + 60);
    const laid = asked.length;
    expect(laid).toBeGreaterThan(1);
    toggleGun();
    await settle(6 * BUILD_CADENCE_MS);
    fireEvent.mouseUp(window, { button: 0 });
    expect(asked.length).toBeGreaterThan(laid); // the run carried on across the toggle
    expect(onAttack).not.toHaveBeenCalled();
  });

  test("right-click no longer mines, whatever the gun is doing", async () => {
    const { canvas, onMine, mining } = heldJobs();
    fireEvent.mouseDown(canvas, { button: 2 });
    await settle(HARVEST_WINDOW);
    expect(mining()).toBe(false);
    fireEvent.mouseUp(window, { button: 2 });
    expect(onMine).not.toHaveBeenCalled();
  });

  // #103 drops the left hold when the menu opens, and #120 put the pick on that same ref, so the
  // pick now goes with it. Nobody asked for that; it is pinned here so it cannot change unnoticed.
  test("opening the Escape menu stops the mining, and none goes into it (#100)", async () => {
    const { canvas, onMine, mining } = heldJobs();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(mining()).toBe(true); // mining was really running when Escape came down
    fireEvent.keyDown(window, { key: "Escape" });
    await settle(HARVEST_WINDOW); // longer than the harvest it interrupted
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).not.toHaveBeenCalled();
  });

  // Death drops the left hold from inside `fireIfDue`, which only runs with the gun up, so a stowed
  // hold outlives it — refused while dead, and mining again the moment the player is back and in
  // reach. Recorded rather than chosen: it is what mining did on its old button. The respawn below
  // is the observable case, not a contrived one — `reviveSelf` snaps to arena centre and
  // `BOOTSTRAP_PATCHES` seeds metal within reach of it (build.ts:110).
  test("a stowed hold outlives a death, and mines again on respawn with no fresh press", async () => {
    const middle = { x: ARENA.width / 2, y: ARENA.height / 2 };
    const centreTile = { tx: Math.floor(middle.x / TILE), ty: Math.floor(middle.y / TILE) };
    const world = armed(0); // down before the button ever goes near it
    world.ore.set(tileKey(centreTile), "metal"); // the bootstrap patch respawn puts you on
    const { canvas, onMine } = heldJobs(world);
    fireEvent.mouseDown(canvas, { button: 0, clientX: middle.x, clientY: middle.y });
    await settle(HARVEST_WINDOW);
    expect(onMine).not.toHaveBeenCalled(); // a corpse mines nothing, however long it holds
    world.reviveSelf();
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).toHaveBeenCalledWith(centreTile);
  });

  // Two buttons, two holds: letting one go must not let the other go with it. The cursor's tile
  // carries a structure, so right-click has something to pull down and left-click has nothing to
  // mine out from under it.
  test("releasing left-click leaves the demolish hold alone", async () => {
    const world = armed();
    insertStructure(world.build, { id: "m1", kind: "miner", tile: CURSOR_TILE, hp: 200 });
    const onDemolish = mock(() => {});
    const canvas = renderMatch({ onDemolish }, world);
    fireEvent.mouseDown(canvas, { button: 2 });
    fireEvent.mouseDown(canvas, { button: 0 });
    fireEvent.mouseUp(window, { button: 0 });
    await settle(DEMOLISH_WINDOW);
    fireEvent.mouseUp(window, { button: 2 });
    expect(onDemolish).toHaveBeenCalledWith("m1");
  });

  // And the same in the other direction, which is the one the shared ref put at risk: the pick and
  // the trigger are now one flag, so a release that reached across buttons would drop whichever of
  // them was running. The pin is what shows the survivor — the mine is still live several frames
  // after the other button came up.
  test("releasing the demolish hold leaves left-click's alone", async () => {
    const { canvas, mining } = heldJobs();
    fireEvent.mouseDown(canvas, { button: 0 });
    fireEvent.mouseDown(canvas, { button: 2 });
    fireEvent.mouseUp(window, { button: 2 });
    await nextFrames();
    expect(mining()).toBe(true);
    fireEvent.mouseUp(window, { button: 0 });
  });
});

describe("#105: hovering the Metal readout shows Metal per second", () => {
  const withMiners = (count: number) => {
    const world = armed();
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: Array.from({ length: count }, (_, i) => ({
          id: `m${i}`,
          kind: "miner" as const,
          tile: { tx: 40 + i * 2, ty: 40 },
          hp: 200,
        })),
      },
      Date.now(),
    );
    return world;
  };
  // The HUD mirrors the world on the same ~20 Hz timer that streams position, so the readout is a
  // tick behind the delta rather than immediate. Inside `act`, because that tick is what re-renders.
  const mirrored = () => act(() => sleep(POS_SEND_MS + 30));
  // What the box shows a player: its unit, and the figure set beside it as the bank total is.
  const unit = () => screen.getByText("metal / s");
  const figure = () => unit().nextElementSibling?.textContent;

  test("names the unit it is measuring, and reads miners × MINER_TRICKLE", async () => {
    inMatch(() => {}, withMiners(3));
    await mirrored();
    expect(unit().textContent).toBe("metal / s");
    expect(figure()).toBe(String(3 * MINER_TRICKLE));
  });

  test("is zero with nothing standing, and moves as miners are built", async () => {
    const world = withMiners(0);
    inMatch(() => {}, world);
    await mirrored();
    expect(figure()).toBe("0");
    world.applyMapDelta(
      {
        tick: 2,
        moves: [],
        builds: [{ id: "m9", kind: "miner", tile: { tx: 60, ty: 60 }, hp: 200 }],
      },
      Date.now(),
    );
    await mirrored();
    expect(figure()).toBe(String(MINER_TRICKLE));
  });

  // Hover and focus on the readout are what slide the box out, and both are CSS — only a browser can
  // say whether it moved. What is checkable here is the structure that reveal stands on: the box
  // inside the readout, and a readout keyboard focus can land on. A `<span>` in its place, or the box
  // hoisted out to a sibling, leaves the reading reachable by pointer alone.
  test("hides inside a readout that keyboard focus can reach, not the pointer alone", async () => {
    inMatch(() => {}, withMiners(1));
    await mirrored();
    const readout = screen.getByText("Metal").parentElement as HTMLElement;
    expect(readout.contains(unit())).toBe(true);
    expect(readout.tabIndex).toBeGreaterThanOrEqual(0);
    readout.focus();
    expect(document.activeElement).toBe(readout);
  });
});

describe("#98: a build slot states its cost and its name", () => {
  const mirrored = () => act(() => sleep(POS_SEND_MS + 30));
  // `mine`, not `miner` — the author's wording for the label. The domain type stays `miner`.
  const NAMES: Record<string, string> = {
    miner: "mine",
    wall: "wall",
    turret: "turret",
    generator: "generator",
  };

  test("puts the registry's Metal cost in the circle and the one-word name under the art", () => {
    inMatch(() => {});
    for (const kind of BUILD_SLOTS) {
      const slot = screen.getByLabelText(kind);
      // Read through the registry, so a rebalance moves the circle with it (#101 is coming for the
      // turret). In the circle, not merely in the slot: a loose numeral would pass either way.
      expect(slot.querySelector(".build-cost")?.textContent).toBe(String(BUILDABLES[kind]?.cost));
      expect(slot.querySelector(".build-name")?.textContent).toBe(NAMES[kind]);
      // And nothing else: the cost and the name are the only words ADR 0001 grants a slot.
      expect(slot.textContent).toBe(`${BUILDABLES[kind]?.cost}${NAMES[kind]}`);
    }
  });

  // #101: the circle has to quote what the placement will actually be charged, not the base — a
  // slot reading 60 while the server debits 101 is a refused placement with nothing to explain it.
  test("the turret circle climbs with the squad's standing turrets; the rest hold", async () => {
    const world = armed();
    inMatch(() => {}, world);
    const circle = (kind: string) =>
      screen.getByLabelText(kind).querySelector(".build-cost")?.textContent;
    await mirrored();
    expect(circle("turret")).toBe("60");

    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: [
          { id: "t1", kind: "turret", tile: { tx: 40, ty: 40 }, hp: 250 },
          { id: "t2", kind: "turret", tile: { tx: 44, ty: 40 }, hp: 250 },
        ],
      },
      Date.now(),
    );
    await mirrored();
    expect(circle("turret")).toBe("101");
    expect(circle("miner")).toBe("50");
    expect(circle("wall")).toBe("10");
    expect(circle("generator")).toBe("150");

    world.applyMapDelta({ tick: 2, moves: [], removals: ["t1"] }, Date.now());
    await mirrored();
    expect(circle("turret")).toBe("78");
  });
});

describe("#100: Escape opens the menu", () => {
  test("Escape opens it and Escape closes it", () => {
    renderMatch();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("it holds Leave and nothing else", () => {
    renderMatch();
    fireEvent.keyDown(window, { key: "Escape" });
    const menu = screen.getByRole("dialog");
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Leave"]);
  });

  test("Leave ends the match on the click, with no confirmation in between", () => {
    const onLeave = mock(() => {});
    renderMatch({ onLeave });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test("leaving is reachable only through the menu — the header button is gone", () => {
    renderMatch();
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
  });

  test("focus enters the menu on open and returns to the arena on close", () => {
    const canvas = renderMatch();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Leave" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(canvas);
  });

  test("opening it releases held movement — the next step sees NO_MOVE", async () => {
    const world = armed();
    const moves = recordMoves(world);
    renderMatch({}, world);
    fireEvent.keyDown(window, { key: "w" });
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
  });

  test("movement is never locked while it is open, and works again once it closes", async () => {
    const world = armed();
    const moves = recordMoves(world);
    renderMatch({}, world);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "d" });
    await nextFrames();
    expect(moves.at(-1)?.right).toBe(true);
    fireEvent.keyUp(window, { key: "d" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "w" });
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
  });
});

describe("#100: right-click cancels a selected buildable", () => {
  // A miner stands on the cursor's tile, so a right-click that armed its hold instead of spending
  // itself on the cancel would pull it down once the hold elapsed.
  const withStructure = () => {
    const world = armed();
    insertStructure(world.build, { id: "m1", kind: "miner", tile: CURSOR_TILE, hp: 200 });
    return world;
  };

  test("it clears the selection and arms no demolish", async () => {
    const onDemolish = mock(() => {});
    const canvas = renderMatch({ onDemolish }, withStructure());
    const wall = screen.getByLabelText("wall");
    fireEvent.click(wall);
    fireEvent.mouseDown(canvas, { button: 2 });
    expect(wall.getAttribute("aria-pressed")).toBe("false");
    await settle(DEMOLISH_WINDOW);
    expect(onDemolish).toHaveBeenCalledTimes(0);
  });

  test("with nothing selected it demolishes what is under the cursor, once the hold is out", async () => {
    const onDemolish = mock(() => {});
    const canvas = renderMatch({ onDemolish }, withStructure());
    fireEvent.mouseDown(canvas, { button: 2 });
    await settle(STRUCTURE_HARVEST_MS / 2); // inside the harvest: nothing yet
    expect(onDemolish).toHaveBeenCalledTimes(0);
    await settle(DEMOLISH_WINDOW);
    fireEvent.mouseUp(window, { button: 2 });
    expect(onDemolish).toHaveBeenCalledWith("m1");
  });

  // Harvest progress is a separate statistic from HP (#130), and this is where the two would quietly
  // merge: a wall chewed to a sliver by enemies must cost the same hold to pull down as an untouched
  // one, or "time to demolish" becomes a second, invisible health bar.
  test.each([(BUILDABLES.miner as BuildableSpec).hp, 1])(
    "a building at %i HP takes the same hold to pull down",
    async (hp) => {
      const world = armed();
      insertStructure(world.build, { id: "m1", kind: "miner", tile: CURSOR_TILE, hp });
      const onDemolish = mock(() => {});
      const canvas = renderMatch({ onDemolish }, world);
      fireEvent.mouseDown(canvas, { button: 2 });
      await settle(STRUCTURE_HARVEST_MS / 2);
      expect(onDemolish).toHaveBeenCalledTimes(0); // not half-way to gone, whatever its HP
      await settle(DEMOLISH_WINDOW);
      fireEvent.mouseUp(window, { button: 2 });
      expect(onDemolish).toHaveBeenCalledWith("m1"); // and gone by the same hold, whatever its HP
    },
  );
});

// #117 reverses the stance #100 shipped: Escape cancels a selected buildable, and reaches the menu
// only once there is nothing to cancel. Right-click keeps the job #100 gave it, so both do it now.
describe("#117: Escape cancels a selected buildable first", () => {
  test("with one selected it clears the selection and opens nothing", () => {
    renderMatch();
    const wall = screen.getByLabelText("wall");
    fireEvent.click(wall);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wall.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the next Escape, with the selection gone, opens the menu", () => {
    renderMatch();
    fireEvent.click(screen.getByLabelText("wall"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("an open menu closes on Escape even with the build bar taken behind it", () => {
    renderMatch();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The build bar's keys still reach the window listener from behind the modal. A selection taken
    // there must not cost the menu its own key, or Escape would no longer close what it opened.
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByLabelText("wall").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("#109: hand-mining Metal ore pins the player where it stands", () => {
  const overMetal = (self: Vec2 = init.spawns[0].pos) => {
    const world = new ClientWorld({ ...init, spawns: [{ ...init.spawns[0], pos: self }] }, "me");
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    return world;
  };

  // Start the mine, then try to walk out of it. The events are synchronous and no frame has run
  // between them, so the position captured here is the one the whole hold is measured against.
  // Left-click, with the gun left stowed as you spawn — #120 moved mining onto it.
  function mineAndWalk(world: ClientWorld, handlers = {}) {
    const moves = recordMoves(world);
    const canvas = renderMatch(handlers, world);
    fireEvent.mouseDown(canvas, { button: 0 });
    fireEvent.keyDown(window, { key: "w" });
    return { canvas, moves, from: world.selfPos() as Vec2 };
  }

  test("movement input is ignored while the button is held, and the player does not move", async () => {
    const world = overMetal();
    const { moves, from } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
    expect(world.selfPos()).toEqual(from);
  });

  test("releasing it restores movement on the very next input read, with no tail", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
    const released = moves.length;
    fireEvent.mouseUp(window, { button: 0 });
    await nextFrames();
    expect(moves[released]?.up).toBe(true);
  });

  // The pin and the progress are one answer read once a frame (#130), so a blur that lifts the pin
  // has necessarily dropped the progress behind it: the whole harvest window below passes with the
  // button still notionally down and nothing comes out of the ground.
  test("blur mid-mine releases the harvest and the pin together", async () => {
    const onMine = mock(() => {});
    const world = overMetal();
    const { moves } = mineAndWalk(world, { onMine });
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
    const blurred = moves.length;
    fireEvent.blur(window);
    await settle(HARVEST_WINDOW);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves[blurred]?.up).toBe(true);
  });

  test("a player who dies mid-mine is not pinned on respawn", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
    world.applyPeerHealth("me", 0, 1); // down mid-mine, with right-click still held
    await nextFrames();
    world.reviveSelf();
    // Respawning snaps you to the arena centre, half the map from the ore you died on — so the
    // harvest cannot resume even with the button still down, and nothing carries the pin over.
    const revived = moves.length;
    await nextFrames();
    expect(moves[revived]?.up).toBe(true);
  });

  // The server refuses a mine reported from further off than INTERACT_REACH (build.ts:209). A pin
  // there would freeze the player banking nothing, so the client asks for nothing either.
  test("Metal ore beyond INTERACT_REACH starts no harvest, and so imposes no pin", async () => {
    const { moves } = mineAndWalk(overMetal({ x: INTERACT_REACH * 2, y: 300 }));
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
  });

  // The pin follows whether a harvest is running, not whether the button is down — which is exactly
  // what makes it the readable half of client-side progress (#130). Every one of these holds
  // left-click on something that resolves to no mine.
  test("bare grass starts no harvest and imposes no pin", async () => {
    const { moves } = mineAndWalk(armed());
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
  });

  test("power ore starts no harvest and imposes no pin", async () => {
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "power");
    const { moves } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
  });

  test("an occupied tile is a demolish, not a mine, so it imposes no pin", async () => {
    const world = overMetal(); // a miner sits on metal ore by definition
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: [{ id: "m1", kind: "miner", tile: CURSOR_TILE, hp: 200 }],
      },
      Date.now(),
    );
    const { moves } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);
  });

  // #100 lets held movement go when the menu opens; the pin must not outlive the button under it.
  test("the escape menu opened mid-mine leaves nothing pinned once the button is up", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await nextFrames();
    expect(moves.at(-1)).toEqual(NO_MOVE);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(window, { button: 0 });
    fireEvent.keyDown(window, { key: "w" });
    const released = moves.length;
    await nextFrames();
    expect(moves[released]?.up).toBe(true);
  });
});

// #130: a harvest's progress lives exactly as long as the hold making it. `harvest.ts` says so
// about the module; this says it about the screen, which is where the release actually reaches it —
// the button comes up between two frames, and it is the frame that reads it that drops the target.
describe("#130: a released hold banks nothing, and the next press starts the tile from full", () => {
  test("two part-harvests either side of a release do not add up to a Metal", async () => {
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    const onMine = mock(() => {});
    const canvas = renderMatch({ onMine }, world);
    const PART_MS = 0.8 * ORE_HARVEST_MS;

    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(PART_MS);
    fireEvent.mouseUp(window, { button: 0 });
    await nextFrames(); // the release has to be read on a frame to be read at all
    fireEvent.mouseDown(canvas, { button: 0 }); // straight back onto the same tile
    await settle(PART_MS);
    // Two parts are well over one whole harvest, and progress is spent from frame deltas that can
    // only be shorter than the wall clock they ran over — so a Metal here is progress that outlived
    // its hold, never a fast loop.
    expect(onMine).not.toHaveBeenCalled();

    await settle(HARVEST_WINDOW); // and the fresh harvest, given its own whole length, still lands
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).toHaveBeenCalledWith(CURSOR_TILE);
  });
});

describe("#104: hold and drag left-click to place a run of buildables", () => {
  type Placement = { kind: BuildableKind; tile: Tile };
  const SLOT_KEY: Record<BuildableKind, string> = {
    miner: "1",
    wall: "2",
    turret: "3",
    generator: "4",
  };
  const WALL_COST = (BUILDABLES.wall as BuildableSpec).cost;
  // The canvas rect is all zeros under happy-dom and the camera never leaves the origin, so a
  // client coordinate is its own world coordinate and a tile is `TILE` pixels wide.
  const atTile = (tx: number, ty = 0) => ({ clientX: tx * TILE, clientY: ty * TILE });
  const tilesOf = (asked: Placement[]) => asked.map((p) => p.tile);
  // The Manhattan step between each placement and the one before it. A run with any step but 1 has
  // a hole in it.
  const steps = (tiles: Tile[]) =>
    tiles.slice(1).map((t, i) => {
      const prev = tiles[i] as Tile;
      return Math.abs(t.tx - prev.tx) + Math.abs(t.ty - prev.ty);
    });

  const funded = (metal: number) => {
    const world = armed();
    world.build.bank.metal = metal;
    return world;
  };

  // Press left-click at tile 0,0 with `kind` selected, watching every placement the drag asks for.
  // Nothing is mirrored back, so the tiles asked for are the path the drag walked and nothing else.
  function drag(kind: BuildableKind, world = funded(100_000)) {
    const asked: Placement[] = [];
    const canvas = renderMatch({ onBuild: (k, tile) => asked.push({ kind: k, tile }) }, world);
    fireEvent.keyDown(window, { key: SLOT_KEY[kind] });
    fireEvent.mouseDown(canvas, { button: 0, ...atTile(0) });
    return { canvas, asked, world };
  }

  // The same drag with each placement applied to the mirror the way the server's delta would — the
  // bank debited at the price `buildCost` quotes, the structure standing. The drag reads its own
  // affordability off that mirror, so an economy test has to keep it honest.
  function dragBanked(kind: BuildableKind, world: ClientWorld) {
    const asked: Placement[] = [];
    const canvas = renderMatch(
      {
        onBuild: (k, tile) => {
          asked.push({ kind: k, tile });
          placeStructure(world.build, k, tile, BUILDABLES[k] as BuildableSpec);
        },
      },
      world,
    );
    fireEvent.keyDown(window, { key: SLOT_KEY[kind] });
    fireEvent.mouseDown(canvas, { button: 0, ...atTile(0) });
    return { canvas, asked, world };
  }

  test("a fast drag places all twenty tiles of a straight path, in order and with no gaps", async () => {
    const { canvas, asked } = drag("wall");
    // Nineteen tiles crossed between two pointer reads. A drag that placed where the cursor is
    // would place two of these twenty; the path between the samples is what the rest come from.
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(20 * BUILD_CADENCE_MS + 500);
    fireEvent.mouseUp(window);
    expect(tilesOf(asked)).toEqual(Array.from({ length: 20 }, (_, tx) => ({ tx, ty: 0 })));
  });

  test("a diagonal drag lays a connected run — no corner an enemy could walk through", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(5, 4));
    await settle(10 * BUILD_CADENCE_MS + 400);
    fireEvent.mouseUp(window);
    expect(tilesOf(asked).at(-1)).toEqual({ tx: 5, ty: 4 });
    expect(steps(tilesOf(asked)).filter((step) => step !== 1)).toEqual([]);
  });

  test("the tile the drag started on is placed exactly once", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, { clientX: TILE - 1, clientY: TILE - 1 }); // moved, same tile
    await settle(3 * BUILD_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(tilesOf(asked)).toEqual([{ tx: 0, ty: 0 }]);
  });

  test("a tile that cannot be built on is skipped, and the drag carries on past it", async () => {
    const world = funded(100_000);
    // Already standing across tiles 4 and 5 of the row. A 2×2 wall starting on 3, 4 or 5 overlaps
    // it and nothing else on the row does, so the run has a known hole in a known place.
    insertStructure(world.build, { id: "standing", kind: "wall", tile: { tx: 4, ty: 0 }, hp: 400 });
    const { canvas, asked } = drag("wall", world);
    fireEvent.mouseMove(canvas, atTile(8));
    await settle(9 * BUILD_CADENCE_MS + 400);
    fireEvent.mouseUp(window);
    expect(tilesOf(asked).map((t) => t.tx)).toEqual([0, 1, 2, 6, 7, 8]);
  });

  test("running out of Metal ends the drag, and income arriving mid-gesture does not restart it", async () => {
    const world = funded(3 * WALL_COST);
    const { canvas, asked } = dragBanked("wall", world);
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(8 * BUILD_CADENCE_MS + 300);
    expect(asked).toHaveLength(3);
    world.build.bank.metal = 10_000; // the squad's miners pay in, with the button still down
    // And the gesture carries on over fresh tiles it could now afford. A drag that had merely
    // stepped over the tiles it could not pay for would take these; one that ended does not.
    fireEvent.mouseMove(canvas, atTile(40));
    await settle(8 * BUILD_CADENCE_MS + 300);
    fireEvent.mouseUp(window);
    expect(asked).toHaveLength(3);
  });

  test("the bank never goes negative, however far the drag is pulled", async () => {
    const world = funded(4 * WALL_COST + 5); // the fifth wall is what the drag has to refuse
    const { canvas, asked } = dragBanked("wall", world);
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(12 * BUILD_CADENCE_MS + 400);
    fireEvent.mouseUp(window);
    expect(asked).toHaveLength(4);
    expect(world.build.bank.metal).toBe(5);
  });

  test("dragging turrets escalates the price and ends when the bank cannot cover the next", async () => {
    const world = funded(200);
    const { canvas, asked } = dragBanked("turret", world);
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(8 * BUILD_CADENCE_MS + 400);
    fireEvent.mouseUp(window);
    // 60 then 78 leaves 62 against a third at 101 — the escalation is what ends this drag, and it
    // moved during the drag itself.
    expect(asked).toHaveLength(2);
    expect(world.build.bank.metal).toBe(62);
    expect(world.buildCost("turret")).toBe(101);
  });

  test("releasing the button ends the drag, queued path and all", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    fireEvent.mouseUp(window, { button: 0 });
    await settle(5 * BUILD_CADENCE_MS);
    expect(tilesOf(asked)).toEqual([{ tx: 0, ty: 0 }]);
  });

  test("blur ends the drag, so a button let go off-canvas does not keep placing", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    fireEvent.blur(window);
    await settle(5 * BUILD_CADENCE_MS);
    expect(tilesOf(asked)).toEqual([{ tx: 0, ty: 0 }]);
  });

  // #100's menu is opened by a key, so it arrives with no `mouseup` to drop the button under it —
  // the same hole #103 closed for the trigger. A drag left armed would go on laying tiles behind an
  // open modal, at whatever the pointer was last over.
  test("opening the Escape menu ends the drag, and none of it is laid in behind (#100)", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    // Two, because a drag always has the bar taken and the first Escape is spent cancelling that
    // selection (#117). Both inside one `act` so no frame runs between them and the drag is still
    // armed when the menu opens — the state this test exists to catch.
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.getByRole("dialog")).toBeTruthy(); // the menu really is up, not merely the bar cleared
    await settle(5 * BUILD_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(tilesOf(asked)).toEqual([{ tx: 0, ty: 0 }]);
  });

  test("the pointer leaving the arena ends the drag", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    fireEvent.mouseLeave(canvas);
    await settle(5 * BUILD_CADENCE_MS);
    expect(tilesOf(asked)).toEqual([{ tx: 0, ty: 0 }]);
  });

  test("switching the build bar mid-drag places neither the old kind nor the new", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(2 * BUILD_CADENCE_MS + 60);
    const laid = asked.length;
    expect(laid).toBeGreaterThan(1); // the drag was running when the bar was taken
    fireEvent.keyDown(window, { key: "3" }); // the turret takes the bar with the button still down
    await settle(5 * BUILD_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(asked).toHaveLength(laid);
    expect(asked.every((p) => p.kind === "wall")).toBe(true);
  });

  test("right-clicking the selection away mid-drag ends it too", async () => {
    const { canvas, asked } = drag("wall");
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(2 * BUILD_CADENCE_MS + 60);
    const laid = asked.length;
    fireEvent.mouseDown(canvas, { button: 2 });
    await settle(5 * BUILD_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(asked).toHaveLength(laid);
  });

  test("a drag's nth placement lands no sooner than n of the floors the server admits on", async () => {
    const at: number[] = [];
    const world = funded(100_000);
    const canvas = renderMatch({ onBuild: () => at.push(Date.now()) }, world);
    fireEvent.keyDown(window, { key: "2" });
    const pressedAt = Date.now();
    fireEvent.mouseDown(canvas, { button: 0, ...atTile(0) });
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(8 * BUILD_CADENCE_MS + 200);
    fireEvent.mouseUp(window);
    expect(at.length).toBeGreaterThan(4);
    // `BUILD_CADENCE_MS` is `admitBuild`'s own floor, imported rather than restated: a drag that
    // outran it would have the server drop most of what it sent, and the run would come out full
    // of holes. Measured from the press rather than gap to gap, because the harness can only stamp
    // *after* the frame clock the cadence was charged against — a stall in between is charged to
    // the stamp and not to the drag, so a gap reads short on a cadence that was paid in full.
    // Against the press that same stall can only push a stamp later, so nothing but a drag really
    // outrunning the floor can drive one below its due time.
    const slack = at.map((t, i) => t - pressedAt - i * BUILD_CADENCE_MS);
    expect(slack.filter((ms) => ms < 0)).toEqual([]);
  });
});

// #102: a shot costs a bullet from the squad's pool, and the server refuses one it cannot pay for.
// The trigger is gated on the mirrored count for the same reason it is gated on the cadence — a
// line drawn here would claim damage the server never applied (#85). The line and the report leave
// in the same statement, so a shot that is not sent is a shot that is not drawn.
describe("#102: an empty pool refuses the trigger", () => {
  const withAmmo = (bullets: number): ClientWorld => {
    const world = new ClientWorld(init, "me");
    world.build.ammo.bullets = bullets;
    return world;
  };

  test("a click with nothing in the pool sends nothing", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack, withAmmo(0));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(0);
  });

  test("one bullet buys exactly the one click", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack, withAmmo(1));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("an empty pool does not consume the cadence, so the first bullet fires the moment it lands", () => {
    const onAttack = mock(() => {});
    const world = withAmmo(0);
    const canvas = inMatch(onAttack, world);
    fireEvent.mouseDown(canvas, { button: 0 }); // refused: nothing to fire
    world.applyMapDelta({ tick: 1, moves: [], ammo: 1 }, Date.now());
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("a held trigger goes quiet the moment the pool runs dry", async () => {
    const onAttack = mock(() => {});
    const world = withAmmo(1);
    const canvas = inMatch(onAttack, world);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    world.applyMapDelta({ tick: 1, moves: [], ammo: 0 }, Date.now()); // the server took it
    await settle(RANGED_CADENCE_MS * 2);
    fireEvent.mouseUp(window);
    expect(onAttack).toHaveBeenCalledTimes(1); // still 1: the hold has nothing left to spend
  });
});

// #102 stage 3: the ammo box. It is the counter, the queue's circle, the forge's progress overlay
// and the order button all in one square, which is what the ask describes — so every one of them
// is read off the same element here.
describe("#102: the ammo box counts the squad's bullets and orders more", () => {
  const mirrored = () => settle(POS_SEND_MS + 30);
  const box = () => screen.getByLabelText("Forge a bullet");
  const count = () => box().querySelector("strong")?.textContent;
  const circle = () => box().querySelector(".ammo-queued");
  const overlay = () => box().querySelector(".ammo-forge") as HTMLElement | null;
  const empty = () => new ClientWorld(init, "me");

  test("shows the squad's spendable bullets, and moves as the pool does", async () => {
    const world = empty();
    renderMatch({}, world);
    await mirrored();
    expect(count()).toBe("0");
    world.applyMapDelta({ tick: 1, moves: [], ammo: 12 }, Date.now());
    await mirrored();
    expect(count()).toBe("12");
  });

  // "Just above the Energy readout" is a fact about the stack, not about the pixels: the two share
  // a parent and the box comes first. A box hoisted out beside the Metal readout would still look
  // plausible in a screenshot and would be the wrong thing.
  test("sits directly above the Energy readout", () => {
    renderMatch({});
    const energy = screen.getByText("Energy").parentElement as HTMLElement;
    expect(box().parentElement).toBe(energy.parentElement);
    expect(box().nextElementSibling).toBe(energy);
  });

  test("one press orders one bullet", () => {
    const onForge = mock(() => {});
    renderMatch({ onForge }, empty());
    fireEvent.click(box());
    expect(onForge).toHaveBeenCalledTimes(1);
  });

  // `game/forge` is the one player command the hub admits with no cadence and no `seq`, so a held
  // button would be an unpaced path into the shared bank. Until that is settled, the press is the
  // whole of it: holding orders nothing, and only the release's click spends.
  test("holding the button orders nothing until it is released", async () => {
    const onForge = mock(() => {});
    renderMatch({ onForge }, empty());
    fireEvent.mouseDown(box());
    await settle(POS_SEND_MS * 8);
    expect(onForge).toHaveBeenCalledTimes(0);
    fireEvent.mouseUp(box());
    fireEvent.click(box());
    expect(onForge).toHaveBeenCalledTimes(1);
  });

  // The keyboard is the hole the mouse guard above cannot see. A focused button activates on Enter
  // *keydown*, so OS key repeat fires a click per repeat — a held Enter took the count 0 → 8 in one
  // press in headless Chromium. happy-dom does not synthesise native repeat, so this drives the
  // flag the browser sets and asserts the button refuses to be activated by it; the same fix was
  // then confirmed over CDP against a real key-repeat stream.
  test("a repeated Enter is refused, so a held key cannot order a burst", () => {
    const onForge = mock(() => {});
    renderMatch({ onForge }, empty());
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(true); // the press itself still orders
    expect(fireEvent.keyDown(box(), { key: "Enter", repeat: true })).toBe(false);
  });

  test("the circle counts what is still being forged, and is absent with nothing queued", async () => {
    const world = empty();
    renderMatch({}, world);
    await mirrored();
    expect(circle()).toBeNull();
    world.applyMapDelta({ tick: 1, moves: [], queued: 3 }, Date.now());
    await mirrored();
    expect(circle()?.textContent).toBe("3");
    world.applyMapDelta({ tick: 2, moves: [], queued: 0, ammo: 3 }, Date.now());
    await mirrored();
    expect(circle()).toBeNull();
  });

  test("the overlay is up while a bullet is being forged and gone once the queue drains", async () => {
    const world = empty();
    renderMatch({}, world);
    await mirrored();
    expect(overlay()).toBeNull();
    world.applyMapDelta({ tick: 1, moves: [], queued: 1 }, Date.now());
    await mirrored();
    expect(overlay()).not.toBeNull();
    world.applyMapDelta({ tick: 2, moves: [], queued: 0, ammo: 1 }, Date.now());
    await mirrored();
    expect(overlay()).toBeNull();
  });

  // The box the ask wants cleared bottom to top over one forge has ~20 arrivals to do it in, and a
  // bar recomputed on each of them steps visibly. So the overlay is handed the forge's length once
  // and left alone: the same element, unchanged, across three HUD ticks. A per-tick height would
  // fail on the style; a per-tick remount would fail on the identity.
  test("runs on the forge's own clock rather than stepping with the stream", async () => {
    const world = empty();
    renderMatch({}, world);
    world.applyMapDelta({ tick: 1, moves: [], queued: 2 }, Date.now());
    await mirrored();
    const first = overlay();
    expect(first?.style.animationDuration).toBe(`${FORGE_MS}ms`);
    const style = first?.getAttribute("style");
    // The bank moves under it throughout, as it does in any real match, so the HUD is genuinely
    // re-rendering on each of these ticks — rather than the overlay surviving because nothing
    // anywhere on screen happened to change.
    for (let tick = 2; tick <= 4; tick++) {
      world.applyMapDelta({ tick, moves: [], bank: { metal: tick } }, Date.now());
      await mirrored();
    }
    expect(overlay()).toBe(first);
    expect(overlay()?.getAttribute("style")).toBe(style);
  });

  test("the bullet behind the one that just landed starts the overlay again", async () => {
    const world = empty();
    renderMatch({}, world);
    world.applyMapDelta({ tick: 1, moves: [], queued: 2 }, Date.now());
    await mirrored();
    const first = overlay();
    expect(first).not.toBeNull();
    world.applyMapDelta({ tick: 2, moves: [], queued: 1, ammo: 1 }, Date.now());
    await mirrored();
    expect(overlay()).not.toBe(first);
  });
});

// #150: the refused trigger left no trace at all — eight clicks at a nest with an empty pool put
// nothing on screen. The acknowledgement goes on the ammo box, which is where the `0` the pull was
// refused over already sits, so every assertion below reads it off that one element.
describe("#150: a refused trigger is acknowledged on the ammo box", () => {
  const box = () => screen.getByLabelText("Forge a bullet");
  const mark = () => box().querySelector(".ammo-refused");
  const empty = () => new ClientWorld(init, "me"); // a fresh world's pool is dry
  const armedWith = (bullets: number): ClientWorld => {
    const world = empty();
    world.build.ammo.bullets = bullets;
    return world;
  };

  test("a pull on an empty pool is distinguishable from one that was never made", () => {
    const canvas = inMatch(() => {}, empty());
    expect(mark()).toBeNull(); // nothing pulled, nothing marked
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(mark()).not.toBeNull();
  });

  // The ticket's own playtest. A mark that latched would leave clicks 2–8 as unacknowledged as they
  // are today, so each pull is asserted to have restarted it — a fresh element is a fresh animation,
  // which is the same thing the forge overlay is restarted by.
  test("each of eight clicks is its own refusal", async () => {
    const canvas = inMatch(() => {}, empty());
    const seen = new Set<Element>();
    for (let click = 0; click < 8; click++) {
      fireEvent.mouseDown(canvas, { button: 0 });
      const struck = mark();
      expect(struck).not.toBeNull();
      seen.add(struck as Element);
      fireEvent.mouseUp(window);
      await settle(REFUSAL_MS + 20);
    }
    expect(seen.size).toBe(8);
  });

  // The other side of the floor, and the reason there is one: a hold is a trigger pull that never
  // stops, so it is refused on every frame. Two pulls in the same instant are one acknowledgement,
  // which is what keeps a held dry trigger from remounting the mark — and re-rendering the HUD —
  // sixty times a second. The gap the eight clicks above leave clears it; a frame does not.
  test("two pulls inside the floor share one acknowledgement", () => {
    const canvas = inMatch(() => {}, empty());
    fireEvent.mouseDown(canvas, { button: 0 });
    const first = mark();
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(canvas, { button: 0 }); // the same instant, so the floor swallows it
    expect(mark()).toBe(first);
    fireEvent.mouseUp(window);
  });

  test("a held trigger keeps the box struck rather than acknowledging once", async () => {
    const canvas = inMatch(() => {}, empty());
    fireEvent.mouseDown(canvas, { button: 0 });
    const pressed = mark();
    await settle(REFUSAL_MS * 4);
    expect(mark()).not.toBeNull(); // still struck: the hold is still being refused
    expect(mark()).not.toBe(pressed); // and renewed since the press, not left to fade under it
    fireEvent.mouseUp(window);
  });

  test("a pull that fires is unchanged and leaves no mark", () => {
    const onAttack = mock(() => {});
    const canvas = inMatch(onAttack, armedWith(1));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
    expect(mark()).toBeNull();
  });

  // The refusal is acknowledged and nothing else: it must not cost the first shot after a bullet
  // lands, which is the very thing the ammo gate is ordered before the cadence to protect (#102).
  test("a struck box does not stand between the pool refilling and the next shot", () => {
    const onAttack = mock(() => {});
    const world = empty();
    const canvas = inMatch(onAttack, world);
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(mark()).not.toBeNull();
    world.applyMapDelta({ tick: 1, moves: [], ammo: 1 }, Date.now());
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  // ADR 0001: a mark, not a word — and not a word read out to a screen reader either.
  test("the mark writes nothing", () => {
    const canvas = inMatch(() => {}, empty());
    fireEvent.mouseDown(canvas, { button: 0 });
    const struck = mark() as HTMLElement;
    expect(struck.textContent).toBe("");
    expect(struck.childElementCount).toBe(0);
    expect(struck.hasAttribute("aria-label")).toBe(false);
    expect(struck.hasAttribute("title")).toBe(false);
  });

  // What is acknowledged is a *trigger* pull. With the gun stowed left-click mines (#120), and a
  // pick that never asked the pool for anything has not been refused by it.
  test("a stowed gun's left-click marks nothing", async () => {
    const canvas = renderMatch({}, empty()); // no `equipGun`
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(REFUSAL_MS + 20);
    expect(mark()).toBeNull();
    fireEvent.mouseUp(window);
  });
});

// #110: the corner map's zoom, driven from the keyboard. Every other test in this file reads the
// DOM, and the zoom level never reaches it — it is a ref the render loop hands `drawWorld`, so what
// was drawn is the only place it is visible. happy-dom draws nothing at all: `getContext("2d")`
// answers null and every element measures 0×0, so the loop's `w > 0 && h > 0` guard never opens.
//
// This stands a recording context and a real viewport up for the length of one test, which is what
// makes the map readable from here. The stub is on the prototype and so covers the sprite bakes
// too, which is required rather than incidental: `bakeOne` throws on a null context. Those bakes
// land in the module-level cache and stay there, harmlessly — no other test in this file draws.
// `into` is which canvas the call was drawn on. The arena is not the only one on screen — every
// `SpriteIcon` in the HUD is a canvas of its own — so a test about one icon's ink has to be able to
// tell that icon's bake from the whole frame painted behind it (#120).
interface DrawnCall {
  fn: string;
  args: unknown[];
  into: HTMLCanvasElement;
}

function recordFrames(): { calls: DrawnCall[]; restore: () => void } {
  const calls: DrawnCall[] = [];
  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const getContext = canvas.getContext;
  const element = HTMLElement.prototype;
  const width = Object.getOwnPropertyDescriptor(element, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(element, "clientHeight");
  Object.defineProperty(element, "clientWidth", { get: () => 800, configurable: true });
  Object.defineProperty(element, "clientHeight", { get: () => 600, configurable: true });
  // A proxy rather than a table of methods: the sprite modules between them reach for most of the
  // 2D API, and a missing name would fail as a broken bake rather than as a missing stub.
  canvas.getContext = function (this: HTMLCanvasElement) {
    const into = this;
    const state: Record<string, unknown> = {};
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) => {
        if (name in state) return state[name];
        // The one call in the 2D API a recorder cannot merely record: the tutorial's sentences
        // wrap (#134), so the draw path uses what comes back. A fixed width per character, as the
        // spy in `draw.test.ts` uses, since nothing here is an assertion about a font metric.
        if (name === "measureText") {
          return (text: string) => {
            calls.push({ fn: name, args: [text], into });
            return { width: String(text).length * 6 };
          };
        }
        return (...args: unknown[]) => {
          calls.push({ fn: name, args, into });
        };
      },
      set: (_target, name: string, value) => {
        state[name] = value;
        return true;
      },
    });
  };
  return {
    calls,
    restore() {
      canvas.getContext = getContext;
      if (width) Object.defineProperty(element, "clientWidth", width);
      if (height) Object.defineProperty(element, "clientHeight", height);
    },
  };
}

// A wall far enough from the spawn to be measurably off the plate's centre and near enough to sit
// inside even the closest window, so it is on the map at all three levels.
const MARK_TILE = { tx: 60, ty: 20 };
const MARK_OFFSET_U =
  footprintCenter(MARK_TILE, (BUILDABLES.wall as BuildableSpec).footprint).x - SPAWN.x;

// The coverage the last complete map in the log was a window onto, in world units — read back out
// of the ink. The plate is 200 px at every level, so the level is not in its size; it is in where a
// mark of a known world offset landed, which is that offset times the scale the coverage sets.
//
// Bounded to one map, from its rule — the last thing `drawMinimap` draws — back to its plate, so a
// recording that stopped mid-frame is short a map rather than reading half of two.
function drawnCoverage(calls: DrawnCall[]): number | null {
  const plated = (c: DrawnCall) => c.args[2] === MINIMAP_SIZE && c.args[3] === MINIMAP_SIZE;
  const rule = calls.findLastIndex((c) => c.fn === "strokeRect" && plated(c));
  const plate = calls.findLastIndex((c, i) => i < rule && c.fn === "fillRect" && plated(c));
  if (plate < 0) return null;
  // The only other fill on the plate: this world's ore is cleared and its door unfound, which
  // leaves the structure marks, and there is one structure.
  const mark = calls.slice(plate + 1, rule).find((c) => c.fn === "fillRect");
  if (!mark) return null;
  const centre = (calls[plate].args[0] as number) + MINIMAP_SIZE / 2;
  const at = (mark.args[0] as number) + (mark.args[2] as number) / 2;
  return (MINIMAP_SIZE * MARK_OFFSET_U) / (at - centre);
}

describe("#110: the map's zoom steps once per press of the key", () => {
  let drawn: { calls: DrawnCall[]; restore: () => void };

  beforeEach(() => {
    drawn = recordFrames();
  });
  afterEach(() => drawn.restore());

  // One wall on an empty floor, so the only mark on the plate besides the squad is the one the
  // level is read off.
  function marked(): ClientWorld {
    const world = armed();
    world.ore.clear();
    insertStructure(world.build, { id: "mark", kind: "wall", tile: MARK_TILE, hp: 400 });
    return world;
  }

  test("one press takes the map from the level it opened on to the next", async () => {
    renderMatch({}, marked());
    await nextFrames();
    expect(drawnCoverage(drawn.calls)).toBeCloseTo(MINIMAP_COVERAGE_U, 6);
    fireEvent.keyDown(window, { key: MINIMAP_ZOOM_KEY });
    await nextFrames();
    expect(drawnCoverage(drawn.calls)).toBeCloseTo(MINIMAP_COVERAGE_CLOSE_U, 6);
  });

  // The hole the press above cannot see. The OS repeats a held key at ~30 Hz and every repeat is
  // another keydown, so a cycle stepped by each of them would spin the map through ten levels a
  // second. happy-dom does not synthesise native repeat, so this drives the flag the browser sets —
  // the same technique the ammo box's Enter guard is pinned by above.
  test("a repeat of a held key steps it nowhere", async () => {
    renderMatch({}, marked());
    await nextFrames();
    fireEvent.keyDown(window, { key: MINIMAP_ZOOM_KEY });
    await nextFrames();
    fireEvent.keyDown(window, { key: MINIMAP_ZOOM_KEY, repeat: true });
    fireEvent.keyDown(window, { key: MINIMAP_ZOOM_KEY, repeat: true });
    await nextFrames();
    expect(drawnCoverage(drawn.calls)).toBeCloseTo(MINIMAP_COVERAGE_CLOSE_U, 6);
  });
});

// #120: the one thing the HUD says about the gun — one icon over the health bar, filled when the
// weapon is up and hollow when it is not. Filled and hollow are ink, not markup, so they are read
// out of the icon's own bake rather than off an attribute a wrong `facing` would still set.
describe("#120: the gun icon over the health bar is filled or hollow", () => {
  let drawn: { calls: DrawnCall[]; restore: () => void };

  beforeEach(() => {
    drawn = recordFrames();
  });
  afterEach(() => drawn.restore());

  const plate = (state: string) => screen.getByLabelText(state);
  const bakedInto = (icon: HTMLCanvasElement, from: number) =>
    drawn.calls
      .slice(from)
      .filter((c) => c.into === icon)
      .map((c) => c.fn);

  test("it sits directly above the bar", () => {
    renderMatch();
    expect(plate("Gun stowed").nextElementSibling).toBe(screen.getByLabelText("Health"));
  });

  test("stowed it is stroked and never filled; `g` fills the same contour", () => {
    renderMatch();
    const icon = plate("Gun stowed").querySelector("canvas") as HTMLCanvasElement;
    const stowed = bakedInto(icon, 0);
    expect(stowed).toContain("stroke");
    expect(stowed).not.toContain("fill"); // hollow: the contour and nothing inside it
    const mark = drawn.calls.length;
    fireEvent.keyDown(window, { key: GUN_TOGGLE_KEY });
    const equipped = bakedInto(icon, mark);
    expect(equipped).toContain("fill");
    expect(equipped).toContain("stroke"); // the same contour, so the icon does not change size
    expect(plate("Gun equipped").querySelector("canvas")).toBe(icon);
  });

  test("and `g` again empties it", () => {
    renderMatch();
    const icon = plate("Gun stowed").querySelector("canvas") as HTMLCanvasElement;
    fireEvent.keyDown(window, { key: GUN_TOGGLE_KEY });
    const mark = drawn.calls.length;
    fireEvent.keyDown(window, { key: GUN_TOGGLE_KEY });
    expect(bakedInto(icon, mark)).not.toContain("fill");
    expect(plate("Gun stowed")).toBeTruthy();
  });
});

// #142: a blow you take throws the view about and lays a black veil over the frame. Neither reaches
// the DOM — the swing is a translation on the transform and the veil is a fill, both inside the
// render loop — so what was drawn is the only place either is visible, exactly as the map's zoom is.
describe("#142: taking damage shakes the screen and flashes it black", () => {
  let drawn: { calls: DrawnCall[]; restore: () => void };

  beforeEach(() => {
    drawn = recordFrames();
  });
  afterEach(() => drawn.restore());

  // Where the world was painted from on each frame — the two translation terms of the transform the
  // loop sets up, which is the only place the swing shows.
  const views = (calls: DrawnCall[], canvas: HTMLElement) =>
    calls
      .filter((c) => c.into === canvas && c.fn === "setTransform")
      .map((c) => `${c.args[4]},${c.args[5]}`);

  // The viewport-sized fills a stretch of frames laid. One a frame is the paper alone; more than
  // that is the veil behind it.
  const fills = (calls: DrawnCall[], canvas: HTMLElement) =>
    calls.filter(
      (c) => c.into === canvas && c.fn === "fillRect" && c.args[2] === 800 && c.args[3] === 600,
    ).length;

  // A grunt standing at exactly the contact distance: near enough that `updateHealth` lands a blow
  // on the next frame, far enough that `pushOutOfBodies` never shoves the player (`dist >= apart`
  // is its whole condition). The camera therefore never moves, so every difference between one
  // frame's transform and the next is the swing and nothing else.
  const bite = (world: ClientWorld) =>
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [
          {
            id: "e1",
            kind: "grunt",
            pos: { x: SPAWN.x + PLAYER_RADIUS + GRUNT_RADIUS, y: SPAWN.y },
            hp: GRUNT_HP,
          },
        ],
      },
      Date.now(),
    );

  test("an unhurt player's frames all paint from one place, and lay only the paper", async () => {
    const canvas = renderMatch({}, armed());
    await nextFrames();
    const at = drawn.calls.length;
    await nextFrames();
    const quiet = drawn.calls.slice(at);
    expect(views(quiet, canvas).length).toBeGreaterThan(0);
    expect(new Set(views(quiet, canvas)).size).toBe(1);
    expect(fills(quiet, canvas)).toBe(views(quiet, canvas).length);
  });

  test("a blow throws the view about and lays a veil over the frame", async () => {
    const world = armed();
    const canvas = renderMatch({}, world);
    await nextFrames();
    const at = drawn.calls.length;
    bite(world);
    await nextFrames();
    const struck = drawn.calls.slice(at);
    expect(new Set(views(struck, canvas)).size).toBeGreaterThan(1);
    expect(fills(struck, canvas)).toBeGreaterThan(views(struck, canvas).length);
  });

  test("both end on their own and the frame goes back to painting from one place", async () => {
    const world = armed();
    const canvas = renderMatch({}, world);
    bite(world);
    await settle(SHAKE_MS + 40); // past the swing, and well inside the grunt's bite cadence
    const at = drawn.calls.length;
    await nextFrames();
    const settled = drawn.calls.slice(at);
    expect(views(settled, canvas).length).toBeGreaterThan(0);
    expect(new Set(views(settled, canvas)).size).toBe(1);
    expect(fills(settled, canvas)).toBe(views(settled, canvas).length);
  });

  // The veil is a fill on the canvas and the swing is a transform, so neither takes the pointer or
  // covers the arena with anything that could. The aim is the sharper half of the claim: the swing
  // moves what the world is *painted* through and never the camera the cursor is read against, so a
  // shot fired mid-shake goes exactly where a shot fired at rest would.
  test("input stays live through it, and the swing never drags the aim with it", async () => {
    const fired: Vec2[] = [];
    const world = armed();
    const canvas = renderMatch({ onAttack: (_pos, dir) => fired.push(dir) }, world);
    equipGun();
    bite(world);
    await settle(20); // inside the veil, and inside the swing
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    expect(fired).toEqual([aimDir({ x: 0, y: 0 }, SPAWN, { x: 0, y: 0 })]);
  });
});

// #136: a Metal dug out by hand floats the same `+1` a miner does, over the tile it came out of.
// Nothing about it reaches the DOM — it is a client-derived mark inside the render loop, off #130's
// at-zero event — so what was drawn is the only place it is visible, as the map's zoom and the
// screen's swing are.
describe("#136: hand-mining a whole Metal floats a +1 over the ore tile", () => {
  let drawn: { calls: DrawnCall[]; restore: () => void };

  beforeEach(() => {
    drawn = recordFrames();
  });
  afterEach(() => drawn.restore());

  // Every `+1` painted into the arena so far. No miner stands in either world below, so a number in
  // the log can only have come out of the hand.
  const plusOnes = (canvas: HTMLElement) =>
    drawn.calls.filter((c) => c.into === canvas && c.fn === "fillText" && c.args[0] === "+1");

  const overMetal = () => {
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    return world;
  };

  test("none floats until a whole Metal is out of the ground, and then one does", async () => {
    const canvas = renderMatch({}, overMetal());
    fireEvent.mouseDown(canvas, { button: 0 }); // the gun starts stowed, so left-click mines (#120)
    await nextFrames();
    expect(plusOnes(canvas)).toEqual([]); // mid-harvest: nothing is banked, so nothing is floated
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    expect(plusOnes(canvas).length).toBeGreaterThan(0);
  });

  test("it rises from the ore tile, not from the player standing off it", async () => {
    const canvas = renderMatch({}, overMetal());
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window, { button: 0 });
    const [first] = plusOnes(canvas);
    expect(first.args[1]).toBe(CURSOR_TILE.tx * TILE + TILE / 2); // centred on the tile...
    expect(first.args[2] as number).toBeLessThanOrEqual(CURSOR_TILE.ty * TILE); // ...off its top edge
    expect(first.args[1]).not.toBe(SPAWN.x); // and not over the player, who is a screen away from it
  });
});

// #134: the mini-tutorial. Six prompts, each owed until the thing it teaches has been done, and
// then never again on this browser. `tutorial.ts` holds every transition and is tested there; what
// is tested here is the wiring — that the two screen-fixed prompts reach the HUD, that each is
// raised and taken down by this client's own doing, and above all that **nothing freezes**.
describe("#134: the mini-tutorial", () => {
  beforeEach(() => localStorage.clear());

  // An enemy appears on this client. Streamed rather than placed, because that is the only way one
  // ever arrives — and it is what makes "a teammate's first enemy is not yours" a question about
  // which client is looking rather than about a check.
  const sight = (world: ClientWorld) =>
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        spawns: [{ id: "e1", kind: "grunt", pos: { x: SPAWN.x + 40, y: SPAWN.y }, hp: GRUNT_HP }],
      },
      Date.now(),
    );

  test("prompt 2 rides the shared bank, and goes when a bullet is ordered", async () => {
    const world = armed();
    renderMatch({}, world);
    await nextFrames();
    expect(screen.queryByText("Click to build ammo. You will need it!")).toBeNull();
    world.build.bank.metal = BULLET_COST;
    await nextFrames();
    expect(screen.getByText("Click to build ammo. You will need it!")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Forge a bullet"));
    await nextFrames();
    expect(screen.queryByText("Click to build ammo. You will need it!")).toBeNull();
  });

  // A lesson is owed until the thing it teaches has *happened*. `enqueueForge` is a silent no-op
  // below `BULLET_COST` (build.ts:429) — no bullet, no broadcast, no feedback — so a curious click
  // at an empty bank must leave prompt 2 owed rather than marking it learned for good on this
  // browser, which is the one failure the tutorial can never recover from.
  test("a click the squad cannot pay for leaves prompt 2 owed", async () => {
    const world = armed();
    world.build.bank.metal = 0;
    renderMatch({}, world);
    await nextFrames();
    fireEvent.click(screen.getByLabelText("Forge a bullet"));
    world.build.bank.metal = BULLET_COST;
    await nextFrames();
    expect(screen.getByText("Click to build ammo. You will need it!")).toBeDefined();
  });

  test("prompt 6 waits for an enemy, then for the key, then for the trigger", async () => {
    const world = armed();
    const canvas = renderMatch({}, world);
    await nextFrames();
    expect(screen.queryByText("Press G to equip/unequip your gun")).toBeNull();
    sight(world);
    await nextFrames();
    expect(screen.getByText("Press G to equip/unequip your gun")).toBeDefined();
    equipGun();
    await nextFrames();
    expect(screen.queryByText("Press G to equip/unequip your gun")).toBeNull();
    expect(screen.getByText("Left click to shoot")).toBeDefined();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(screen.queryByText("Left click to shoot")).toBeNull();
  });

  // The stance this ticket overturned outright: prompt 6 was written as "pause the game", and a
  // live multiplayer world cannot be paused. A player is informed, never held still — so every
  // input the match has is exercised *while* a prompt is on screen.
  test("nothing freezes — every input stays live through a prompt", async () => {
    const onAttack = mock(() => {});
    const world = armed();
    const moves = recordMoves(world);
    const canvas = renderMatch({ onAttack }, world);
    sight(world);
    await nextFrames();
    expect(screen.getByText("Press G to equip/unequip your gun")).toBeDefined();

    fireEvent.keyDown(window, { key: "w" }); // movement is still stepped
    await nextFrames();
    expect(moves.at(-1)?.up).toBe(true);

    fireEvent.keyDown(window, { key: "1" }); // the build bar still takes a slot
    expect(screen.getByLabelText(BUILD_SLOTS[0]).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });

    equipGun(); // the key the prompt names still does what it says
    await nextFrames();
    expect(screen.getByText("Left click to shoot")).toBeDefined();

    fireEvent.mouseDown(canvas, { button: 0 }); // and the trigger still pulls, on the same frame
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("and a prompt asking for a mine never holds up the mine", async () => {
    const onMine = mock(() => {});
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal"); // prompt 1 is up from the first frame
    const canvas = renderMatch({ onMine }, world);
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(HARVEST_WINDOW);
    fireEvent.mouseUp(window);
    expect(onMine).toHaveBeenCalled();
  });

  // Per player, and private. There is no route from a teammate's action into this client's
  // tutorial: a building of theirs arrives as a delta, which teaches nobody anything, while the
  // same building placed here is written down.
  test("a teammate's generator teaches this player nothing; their own teaches them", async () => {
    const world = armed();
    world.build.bank.metal = 1_000;
    world.ore.set(tileKey(CURSOR_TILE), "power");
    const canvas = renderMatch({}, world);
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: [{ id: "g1", kind: "generator", tile: { tx: 60, ty: 60 }, hp: 300 }],
      },
      Date.now(),
    );
    await nextFrames();
    expect(localStorage.getItem("tutorial:learned") ?? "").not.toContain("energy");

    fireEvent.keyDown(window, { key: "4" }); // the generator's own slot
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    expect(localStorage.getItem("tutorial:learned")).toContain("energy");
  });

  test("seen once ever — a landed lesson is not taught again in the next match", async () => {
    const world = armed();
    const canvas = renderMatch({}, world);
    sight(world);
    await nextFrames();
    equipGun();
    fireEvent.mouseDown(canvas, { button: 0 });
    await nextFrames();
    cleanup();

    const next = armed();
    renderMatch({}, next);
    sight(next);
    await nextFrames();
    expect(screen.queryByText("Press G to equip/unequip your gun")).toBeNull();
    expect(screen.queryByText("Left click to shoot")).toBeNull();
  });

  test("with no store to read, the tutorial shows rather than being suppressed", async () => {
    const store = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      const world = armed();
      renderMatch({}, world);
      sight(world);
      await nextFrames();
      expect(screen.getByText("Press G to equip/unequip your gun")).toBeDefined();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
    }
  });
});

// #92: the wheel zooms the camera. The zoom is a ref the render loop reads, like the corner map's
// own level (#110), so nothing about it reaches the DOM — what it changes is the transform the
// frame is painted through, the scale the sprites are baked at, and, most consequentially, where a
// click lands. The recording context below is what makes the first two readable from here.
describe("#92: the wheel zooms the camera", () => {
  // Twenty notches: more than the twelve the range takes, so the zoom is against its stop and the
  // arithmetic below is exact rather than a power of e.
  const spin = (canvas: HTMLElement, deltaY: number) => {
    for (let i = 0; i < 20; i++) fireEvent.wheel(canvas, { deltaY });
  };
  const OUT = 100; // a wheel notch, as Chromium reports one
  const IN = -100;

  test("a placement lands on the tile the cursor is over, not the tile it was over at 1:1", () => {
    const placed: Tile[] = [];
    const world = armed();
    world.build.bank.metal = 100_000;
    const canvas = renderMatch({ onBuild: (_kind, tile) => placed.push(tile) }, world);
    fireEvent.keyDown(window, { key: "2" }); // a wall
    spin(canvas, OUT); // held at ZOOM_MIN, so a CSS pixel is exactly two world units
    fireEvent.mouseDown(canvas, { button: 0, clientX: 4 * TILE, clientY: 0 });
    // Four tiles across the screen at half scale is eight tiles into the world. Miss the zoom here
    // and the ghost is drawn on tile 4 while the wall is built on it — the failure #92 names.
    expect(placed).toEqual([{ tx: 8, ty: 0 }]);
  });

  test("and comes back to the tile it started on when the wheel comes back", () => {
    const placed: Tile[] = [];
    const world = armed();
    world.build.bank.metal = 100_000;
    const canvas = renderMatch({ onBuild: (_kind, tile) => placed.push(tile) }, world);
    fireEvent.keyDown(window, { key: "2" });
    spin(canvas, OUT);
    spin(canvas, IN); // back past 1:1, to ZOOM_MAX
    fireEvent.mouseDown(canvas, { button: 0, clientX: 4 * TILE, clientY: 0 });
    expect(placed).toEqual([{ tx: 1, ty: 0 }]); // 60 px at 3× is 20 world units
  });

  test("the wheel belongs to the arena, so the page never scrolls under it", () => {
    const canvas = renderMatch();
    expect(fireEvent.wheel(canvas, { deltaY: OUT })).toBe(false); // preventDefault was called
  });

  describe("what the frame is painted through", () => {
    let drawn: { calls: DrawnCall[]; restore: () => void };

    beforeEach(() => {
      drawn = recordFrames();
    });
    afterEach(() => drawn.restore());

    const transforms = (calls: DrawnCall[], canvas: HTMLElement) =>
      calls.filter((c) => c.fn === "setTransform" && c.into === canvas).map((c) => c.args[0]);
    // How many device pixels wide the bake behind each blit of the *last* frame in the log is. A
    // sprite is baked at the scale it is drawn at (ADR 0008), so this is the sprite's world box
    // times that scale — the one place a frame says out loud which bake it is holding. Bounded to
    // one frame from its own `setTransform`, because the frames of a gesture deliberately hold
    // different bakes and a set over all of them would say nothing.
    const bakeWidths = (calls: DrawnCall[], canvas: HTMLElement) => {
      const frame = calls.slice(
        calls.findLastIndex((c) => c.fn === "setTransform" && c.into === canvas),
      );
      return new Set(
        frame
          .filter((c) => c.fn === "drawImage" && c.into === canvas)
          .map((c) => (c.args[0] as HTMLCanvasElement).width),
      );
    };

    test("the transform follows the wheel on the very next frame", async () => {
      const canvas = renderMatch();
      await nextFrames();
      const before = transforms(drawn.calls, canvas).at(-1);
      spin(canvas, OUT);
      const at = drawn.calls.length;
      await nextFrames();
      const after = transforms(drawn.calls.slice(at), canvas).at(-1);
      expect(before).toBe(1); // dpr 1 under happy-dom, drawn 1:1
      expect(after).toBe(0.5); // dpr × ZOOM_MIN
    });

    test("the sprites are re-baked at the scale they are now drawn at, once the wheel stops", async () => {
      const canvas = renderMatch();
      await nextFrames();
      const before = bakeWidths(drawn.calls, canvas);
      expect(before.size).toBeGreaterThan(0);
      spin(canvas, OUT);
      // Past `ZOOM_SETTLE_MS`, which is what ADR 0008 asks for: the bake in hand is held and
      // blitted resampled while the hand is moving, and the new one is made once it stops.
      await settle(ZOOM_SETTLE_MS + 120);
      // Every one of them half the device pixels it held, because the world is now drawn at half
      // the scale and a sprite is baked at the scale it is drawn at.
      expect(bakeWidths(drawn.calls, canvas)).toEqual(
        new Set([...before].map((width) => width / 2)),
      );
    });
  });
});
