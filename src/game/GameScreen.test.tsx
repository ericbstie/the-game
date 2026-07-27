import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LobbyState } from "../lobby/client";
import type { WorldInit } from "../lobby/protocol";
import { BUILD_SLOTS, BUILDABLES, MINER_TRICKLE } from "./build";
import { ClientWorld } from "./clientWorld";
import { RANGED_CADENCE_MS } from "./enemies";
import { GameScreen } from "./GameScreen";
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

// A live match with nothing selected on the build bar, so left-click means shoot.
function inMatch(onAttack: () => void, world = new ClientWorld(init, "me")): HTMLElement {
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
      onAttack={onAttack}
      onHealth={() => {}}
      onMine={() => {}}
      onBuild={() => {}}
      onDemolish={() => {}}
    />,
  );
  return screen.getByLabelText("Game arena");
}

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
});
