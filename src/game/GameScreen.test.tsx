import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LobbyState } from "../lobby/client";
import type { MoveInput, Vec2, WorldInit } from "../lobby/protocol";
import {
  BUILD_SLOTS,
  BUILDABLES,
  INTERACT_REACH,
  MINE_CADENCE_MS,
  MINER_TRICKLE,
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

// A live match, returning the arena canvas. Every callback defaults to a no-op, so a test names
// only the one it is watching.
function renderMatch(
  handlers: Partial<Omit<React.ComponentProps<typeof GameScreen>, "state">> = {},
  world = new ClientWorld(init, "me"),
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
      {...handlers}
    />,
  );
  return screen.getByLabelText("Game arena");
}

// A live match with nothing selected on the build bar, so left-click means shoot.
function inMatch(onAttack: () => void, world = new ClientWorld(init, "me")): HTMLElement {
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
    const canvas = inMatch(onAttack, new ClientWorld(init, "me", 0));
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(onAttack).toHaveBeenCalledTimes(0);
  });

  test("and being dead does not consume the cadence, so the first shot back up lands", async () => {
    const onAttack = mock(() => {});
    const world = new ClientWorld(init, "me", 0);
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

describe("#105: hovering the Metal readout shows Metal per second", () => {
  const withMiners = (count: number) => {
    const world = new ClientWorld(init, "me");
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
    const world = new ClientWorld(init, "me");
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
    const world = new ClientWorld(init, "me");
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
    const world = new ClientWorld(init, "me");
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
    const world = new ClientWorld(init, "me");
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
    const world = new ClientWorld(init, "me");
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
    fireEvent.mouseUp(window);
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
    const { moves } = mineAndWalk(new ClientWorld(init, "me"), { onMine });
    await settle(MINE_CADENCE_MS * 3);
    expect(onMine).toHaveBeenCalledTimes(0);
    expect(moves.at(-1)?.up).toBe(true);
  });

  test("power ore starts no harvest and imposes no pin", async () => {
    const onMine = mock(() => {});
    const world = new ClientWorld(init, "me");
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
    fireEvent.mouseUp(window);
    fireEvent.keyDown(window, { key: "w" });
    const released = moves.length;
    await nextFrames();
    expect(moves[released]?.up).toBe(true);
  });
});
