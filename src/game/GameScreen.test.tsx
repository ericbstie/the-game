import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LobbyState } from "../lobby/client";
import type { BuildableKind, MoveInput, Tile, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  type BuildableSpec,
  FORGE_MS,
  INTERACT_REACH,
  insertStructure,
  MINE_CADENCE_MS,
  MINER_TRICKLE,
  placeStructure,
  TILE,
  tileKey,
} from "./build";
import { ClientWorld } from "./clientWorld";
import { RANGED_CADENCE_MS } from "./enemies";
import { GameScreen } from "./GameScreen";
import { NO_MOVE } from "./input";
import { ARENA } from "./world";

const init: WorldInit = {
  arena: ARENA,
  exit: { x: 0, y: 100, width: 18, height: 96 },
  spawns: [{ id: "me", slot: 1, name: "Me", pos: { x: 400, y: 300 } }],
  oreSeed: 1,
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

// A live match with nothing selected on the build bar, so left-click means shoot.
function inMatch(onAttack: () => void, world = armed()): HTMLElement {
  return renderMatch({ onAttack }, world);
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
    const pressedAt = Date.now();
    fireEvent.mouseDown(canvas, { button: 0 });
    return { canvas, shots, pressedAt };
  }

  // Six cadences: the three-second hold the ticket counts six shots over.
  const HOLD_MS = 6 * RANGED_CADENCE_MS;

  test("a three-second hold sends exactly six shots", async () => {
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

  test("mining and firing are held independently — releasing one keeps the other", async () => {
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    const onMine = mock(() => {});
    const shots: Shot[] = [];
    const onAttack = (pos: Vec2, dir: Vec2) => shots.push({ at: Date.now(), pos, dir });
    const canvas = renderMatch({ onMine, onAttack }, world);
    fireEvent.mouseDown(canvas, { button: 2 });
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(MINE_CADENCE_MS * 3);
    const mined = onMine.mock.calls.length;
    expect(mined).toBeGreaterThan(0); // both holds were live
    fireEvent.mouseUp(window, { button: 2 }); // let go of the mine, keep the trigger
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window, { button: 0 });
    expect(onMine).toHaveBeenCalledTimes(mined); // mining stopped
    expect(shots.length).toBeGreaterThan(1); // firing did not
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
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.mouseDown(canvas, { button: 0 });
    await settle(2 * RANGED_CADENCE_MS);
    fireEvent.mouseUp(window);
    expect(shots).toEqual([]);
    // Once: the cursor never left its tile. The run a moving cursor lays is #104's own describe.
    expect(onBuild).toHaveBeenCalledTimes(1);
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

  test("neither opening nor closing it clears a selected buildable", () => {
    renderMatch();
    const wall = screen.getByLabelText("wall");
    fireEvent.click(wall);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wall.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wall.getAttribute("aria-pressed")).toBe("true");
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
  test("it clears the selection and arms no harvest", async () => {
    const onMine = mock(() => {});
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    const canvas = renderMatch({ onMine }, world);
    const wall = screen.getByLabelText("wall");
    fireEvent.click(wall);
    fireEvent.mouseDown(canvas, { button: 2 });
    expect(wall.getAttribute("aria-pressed")).toBe("false");
    // The button is still down. If the cancel had armed the hold, the harvest loop would report
    // mining on its very next tick.
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
  });

  test("with nothing selected it still harvests, as it always did", async () => {
    const onMine = mock(() => {});
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "metal");
    const canvas = renderMatch({ onMine }, world);
    fireEvent.mouseDown(canvas, { button: 2 });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalled();
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
  function mineAndWalk(world: ClientWorld, handlers = {}) {
    const moves = recordMoves(world);
    const canvas = renderMatch(handlers, world);
    fireEvent.mouseDown(canvas, { button: 2 });
    fireEvent.keyDown(window, { key: "w" });
    return { canvas, moves, from: world.selfPos() as Vec2 };
  }

  test("movement input is ignored while the button is held, and the player does not move", async () => {
    const world = overMetal();
    const { moves, from } = mineAndWalk(world);
    await settle(MINE_CADENCE_MS * 3);
    expect(moves.at(-1)).toEqual(NO_MOVE);
    expect(world.selfPos()).toEqual(from);
  });

  test("releasing it restores movement on the very next input read, with no tail", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await settle(MINE_CADENCE_MS * 3);
    expect(moves.at(-1)).toEqual(NO_MOVE);
    const released = moves.length;
    fireEvent.mouseUp(window, { button: 2 });
    await nextFrames();
    expect(moves[released]?.up).toBe(true);
  });

  test("blur mid-mine releases the harvest and the pin together", async () => {
    const onMine = mock(() => {});
    const world = overMetal();
    const { moves } = mineAndWalk(world, { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(moves.at(-1)).toEqual(NO_MOVE);
    const blurred = moves.length;
    onMine.mockClear();
    fireEvent.blur(window);
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves[blurred]?.up).toBe(true);
  });

  test("a player who dies mid-mine is not pinned on respawn", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await settle(MINE_CADENCE_MS * 3);
    expect(moves.at(-1)).toEqual(NO_MOVE);
    world.applyPeerHealth("me", 0, 1); // down mid-mine, with right-click still held
    await settle(MINE_CADENCE_MS * 2);
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
    const onMine = mock(() => {});
    const { moves } = mineAndWalk(overMetal({ x: INTERACT_REACH * 2, y: 300 }), { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves.at(-1)?.up).toBe(true);
  });

  // The pin follows whether a harvest is running, not whether the button is down. Every one of
  // these holds right-click on something that resolves to no mine.
  test("bare grass starts no harvest and imposes no pin", async () => {
    const onMine = mock(() => {});
    const { moves } = mineAndWalk(armed(), { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves.at(-1)?.up).toBe(true);
  });

  test("power ore starts no harvest and imposes no pin", async () => {
    const onMine = mock(() => {});
    const world = armed();
    world.ore.set(tileKey(CURSOR_TILE), "power");
    const { moves } = mineAndWalk(world, { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves.at(-1)?.up).toBe(true);
  });

  test("an occupied tile is a demolish, not a mine, so it imposes no pin", async () => {
    const onMine = mock(() => {});
    const world = overMetal(); // a miner sits on metal ore by definition
    world.applyMapDelta(
      {
        tick: 1,
        moves: [],
        builds: [{ id: "m1", kind: "miner", tile: CURSOR_TILE, hp: 200 }],
      },
      Date.now(),
    );
    const { moves } = mineAndWalk(world, { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves.at(-1)?.up).toBe(true);
  });

  // #100 lets held movement go when the menu opens; the pin must not outlive the button under it.
  test("the escape menu opened mid-mine leaves nothing pinned once the button is up", async () => {
    const world = overMetal();
    const { moves } = mineAndWalk(world);
    await settle(MINE_CADENCE_MS * 3);
    expect(moves.at(-1)).toEqual(NO_MOVE);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(window, { button: 2 });
    fireEvent.keyDown(window, { key: "w" });
    const released = moves.length;
    await nextFrames();
    expect(moves[released]?.up).toBe(true);
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
    // Inside `act` so the menu's own effect has provably run before the clock is let go — the
    // assertion is about what the drag does after the menu is up, not about the race to open it.
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
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

  test("no two placements of a drag are closer than the floor the server admits on", async () => {
    const at: number[] = [];
    const world = funded(100_000);
    const canvas = renderMatch({ onBuild: () => at.push(Date.now()) }, world);
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.mouseDown(canvas, { button: 0, ...atTile(0) });
    fireEvent.mouseMove(canvas, atTile(19));
    await settle(8 * BUILD_CADENCE_MS + 200);
    fireEvent.mouseUp(window);
    expect(at.length).toBeGreaterThan(4);
    // `BUILD_CADENCE_MS` is `admitBuild`'s own floor, imported rather than restated: a drag that
    // outran it would have the server drop most of what it sent, and the run would come out full
    // of holes. The millisecond of slack is the harness's — each stamp is read after the clock the
    // placement was charged against.
    const OBSERVED_SKEW_MS = 1;
    const gaps = at.slice(1).map((t, i) => t - (at[i] ?? 0));
    expect(gaps.filter((gap) => gap < BUILD_CADENCE_MS - OBSERVED_SKEW_MS)).toEqual([]);
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
    const canvas = renderMatch({ onAttack }, withAmmo(0));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(0);
  });

  test("one bullet buys exactly the one click", () => {
    const onAttack = mock(() => {});
    const canvas = renderMatch({ onAttack }, withAmmo(1));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("an empty pool does not consume the cadence, so the first bullet fires the moment it lands", () => {
    const onAttack = mock(() => {});
    const world = withAmmo(0);
    const canvas = renderMatch({ onAttack }, world);
    fireEvent.mouseDown(canvas, { button: 0 }); // refused: nothing to fire
    world.applyMapDelta({ tick: 1, moves: [], ammo: 1 }, Date.now());
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(1);
  });

  test("a held trigger goes quiet the moment the pool runs dry", async () => {
    const onAttack = mock(() => {});
    const world = withAmmo(1);
    const canvas = renderMatch({ onAttack }, world);
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
