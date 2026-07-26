import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LobbyState } from "../lobby/client";
import type { WorldInit } from "../lobby/protocol";
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
