import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MAX_ARENA_SIDE } from "../game/build";
import { MIN_ARENA_SIDE } from "../game/enemies";
import { spriteCache, warmScale } from "../game/spriteCache";
import {
  DEFAULT_WORLD_SETTINGS,
  knobValue,
  type WorldSettings,
  withKnob,
  worldKnobs,
} from "../game/worldSettings";
import { ZOOM_DEFAULT } from "../game/zoom";
import type { SpriteCache } from "../sprite/cache";
import type { LobbyState } from "./client";
import { LobbyScreen } from "./LobbyScreen";
import type { LobbySnapshot } from "./protocol";

afterEach(cleanup);

const snapshot: LobbySnapshot = {
  code: "AB3K",
  phase: "lobby",
  maxPlayers: 6,
  host: "p1",
  players: [
    { id: "p1", name: "Ana", slot: 1, presence: { status: "connected" } },
    { id: "p2", name: "Ben", slot: 2, presence: { status: "disconnected", graceExpiresAt: 0 } },
  ],
  rev: 3,
  settings: DEFAULT_WORLD_SETTINGS,
  tutorial: false,
};

const state: LobbyState = {
  status: "lobby",
  code: "AB3K",
  self: { id: "p2", token: "t", slot: 2 },
  snapshot,
};

// Ana in slot 1 holds the lobby, so `self: p1` is the host's view and `self: p2` the squad's.
const asHost = (over: Partial<LobbySnapshot> = {}): LobbyState => ({
  ...state,
  self: { id: "p1", token: "t", slot: 1 },
  snapshot: { ...snapshot, ...over },
});

describe("LobbyScreen", () => {
  test("shows the shareable code and one row per seat", () => {
    render(
      <LobbyScreen
        state={state}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(screen.getByText("AB3K")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getAllByText(/empty/i)).toHaveLength(4);
  });

  test("marks the host and the current player", () => {
    render(
      <LobbyScreen
        state={state}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText(/host/i)).not.toBeNull(); // Ana in slot 1
    expect(within(rows[1]).getByText(/you/i)).not.toBeNull(); // Ben (self) in slot 2
  });

  test("greys a disconnected player and shows a reconnecting hint", () => {
    render(
      <LobbyScreen
        state={state}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[1].className).toContain("disconnected");
    expect(within(rows[1]).getByText(/reconnecting/i)).not.toBeNull();
  });

  test("shows a Reconnecting banner while the client itself is reconnecting", () => {
    render(
      <LobbyScreen
        state={{ ...state, status: "reconnecting" }}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/reconnecting/i);
  });

  test("only the host sees Start, and clicking it starts the match", () => {
    // `state.self` is Ben (slot 2), not the host — no Start for a non-host.
    render(
      <LobbyScreen
        state={state}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();

    const onStart = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={onStart}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const startBtn = screen.getByRole("button", { name: /start/i });
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalled();
  });
});

// #129. The controls live here, one per knob, and the squad reads the host's choice off the same
// snapshot the roster comes on.
describe("the tutorial box", () => {
  const box = () => screen.getByRole("checkbox", { name: /play tutorial/i }) as HTMLInputElement;

  test("the host can tick it, and the tick is sent", () => {
    const onTutorial = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={onTutorial}
      />,
    );
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(onTutorial).toHaveBeenCalledWith(true);
  });

  // The squad reads the host's answer off the same box rather than a second readout, and cannot
  // move it — the gate is the server's (`setTutorial`), and this is what says so on screen.
  test("a non-host reads the host's answer and cannot change it", () => {
    render(
      <LobbyScreen
        state={{ ...asHost(), self: { id: "p2", token: "t", slot: 2 } }}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(box().disabled).toBe(true);
  });

  test("it shows the choice the session is carrying", () => {
    render(
      <LobbyScreen
        state={{ ...asHost(), snapshot: { ...snapshot, tutorial: true } }}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(box().checked).toBe(true);
  });
});

describe("the world controls", () => {
  // The ceiling a knob is offered, off the knob list rather than written out here, so a retune of
  // `MAX_MULTIPLE` cannot leave the assertion asserting the old figure.
  const ceilingOf = (path: string): number => {
    const max = worldKnobs().find((k) => k.path === path)?.max;
    if (max === undefined) throw new Error(`no ceiling on ${path}`);
    return max;
  };
  // Every control, by accessible name — which is also the proof that each one *has* one.
  const controls = () => screen.getAllByRole("spinbutton") as HTMLInputElement[];

  // One per knob, named for the knob it moves — which is also the ticket's "every exposed knob reaches
  // world generation and the sim": the exposed set is exactly `DEFAULT_WORLD_SETTINGS`'s knobs, and
  // `worldSettings.test.ts` asserts each of those reaches the generator or the sim, one test apiece.
  test("one control per knob the world has, each with an accessible name", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(controls().map((i) => i.name)).toEqual(worldKnobs().map((k) => k.path));
    for (const input of controls()) {
      expect(input.labels?.[0]?.textContent ?? "").not.toBe("");
    }
  });

  // ADR 0005 decided ore distribution and nest distribution are two knobs and closes with "#129 labels
  // them separately" — so a shared name for the pair is a decision this ticket is not allowed to make,
  // not a wording preference. Asserted as two distinct names, each naming what it moves.
  test("the two distributions are labelled as the two knobs they are", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const nameOf = (path: string) =>
      controls().find((i) => i.name === path)?.labels?.[0]?.textContent ?? "";
    expect(nameOf("oreEdgeBias")).toMatch(/ore/i);
    expect(nameOf("nestEdgeBias")).toMatch(/nest/i);
    expect(nameOf("oreEdgeBias")).not.toBe(nameOf("nestEdgeBias"));
  });

  // The ask excludes presets outright, so the absence is asserted rather than assumed: a preset is a
  // choice between named worlds, which in a form is a select or a radio group.
  test("nothing offers a preset world", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  test("each control shows the value the session is holding for its knob", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const shown = controls().map((i) => Number(i.value));
    expect(shown).toEqual(worldKnobs().map((k) => knobValue(DEFAULT_WORLD_SETTINGS, k.path)));
  });

  // The host picks. The whole object goes, because that is what `game/settings` carries — so the one
  // edited knob has to arrive changed and every other knob has to arrive exactly as it was.
  test("the host moving a knob sends the whole world with that one knob changed", () => {
    const onSettings = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /^nests$/i }), {
      target: { value: "9" },
    });
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onSettings.mock.calls[0][0]).toEqual(withKnob(DEFAULT_WORLD_SETTINGS, "nestCount", 9));
  });

  // The squad sees the choice before Start: the same controls, the same numbers, read-only. Hiding
  // them would leave the squad guessing what they are about to play.
  test("a non-host reads the host's world off the same controls and cannot type into it", () => {
    const chosen = withKnob(DEFAULT_WORLD_SETTINGS, "enemyCap", 42) as WorldSettings;
    render(
      <LobbyScreen
        state={{ ...state, snapshot: { ...snapshot, settings: chosen } }}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect((screen.getByRole("spinbutton", { name: /enemy cap/i }) as HTMLInputElement).value).toBe(
      "42",
    );
    for (const input of controls()) expect(input.readOnly).toBe(true);
  });

  test("the host's own controls are not read-only", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    for (const input of controls()) expect(input.readOnly).toBe(false);
  });

  // ADR 0006: the server refuses a bad payload whole rather than clamping it, so a control that can
  // emit one is a control the lobby appears to ignore. Zero is the case no `min` attribute can
  // express — the four strictly-positive knobs have no least offerable value.
  test("a value the server would refuse is never sent, and the control says so", () => {
    const onSettings = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    const width = screen.getByRole("spinbutton", { name: /arena width/i });
    fireEvent.change(width, { target: { value: "0" } });
    expect(onSettings).not.toHaveBeenCalled();
    expect(width.getAttribute("aria-invalid")).toBe("true");
    expect((width as HTMLInputElement).value).toBe("0"); // the host's own typing is not overwritten
  });

  test("a half-typed control sends nothing and is not marked wrong", () => {
    const onSettings = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    const nests = screen.getByRole("spinbutton", { name: /^nests$/i });
    fireEvent.change(nests, { target: { value: "" } });
    expect(onSettings).not.toHaveBeenCalled();
    expect(nests.getAttribute("aria-invalid")).toBeNull();
  });

  // The four counted knobs are the only ones the parser puts a ceiling on, and the control offers
  // exactly that ceiling — read off the knob list rather than written out here, so the two cannot
  // drift apart.
  test("a counted knob offers no more than the server will accept", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    for (const knob of worldKnobs()) {
      if (knob.max === undefined) continue;
      const input = controls().find((i) => i.name === knob.path);
      expect(input?.max).toBe(String(knob.max));
    }
    const onSettings = mock();
    cleanup();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /^nests$/i }), {
      target: { value: String(ceilingOf("nestCount") + 1) },
    });
    expect(onSettings).not.toHaveBeenCalled();
  });

  // Every floor but the arena's is the parser's, and offered exactly as the parser states it. The
  // arena's is this form's own — the next test is where it is asserted.
  test("a knob with a floor offers it, and a strictly-positive knob offers none", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    for (const knob of worldKnobs()) {
      if (knob.path.startsWith("arena.")) continue;
      const input = controls().find((i) => i.name === knob.path);
      expect(input?.getAttribute("min")).toBe(knob.min === undefined ? null : String(knob.min));
    }
  });

  // The one ceiling the parser deliberately does not carry: past `MAX_ARENA_SIDE` the packed tile key
  // collides, which desyncs nobody but stops being a world worth offering (ADR 0006).
  test("the arena is not offered past the side the packed tile key survives", () => {
    const onSettings = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    const width = screen.getByRole("spinbutton", { name: /arena width/i });
    expect(width.getAttribute("max")).toBe(String(MAX_ARENA_SIDE));
    fireEvent.change(width, { target: { value: String(MAX_ARENA_SIDE + 1) } });
    expect(onSettings).not.toHaveBeenCalled();
    fireEvent.change(width, { target: { value: String(MAX_ARENA_SIDE) } });
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  // The other bound the parser does not carry: below `MIN_ARENA_SIDE` the nest band inverts and
  // nests are placed outside the walls the avatar is clamped inside (#153). Offered on both sides
  // rather than on the box as a whole, because the band is read off the shorter one — a floor on
  // the width alone would still let a 20,000 × 5,000 world through.
  test("the arena is not offered below the side the nest band needs, on either side", () => {
    const onSettings = mock();
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={onSettings}
        onTutorial={mock()}
      />,
    );
    for (const name of [/arena width/i, /arena height/i]) {
      const side = screen.getByRole("spinbutton", { name });
      expect(side.getAttribute("min")).toBe(String(MIN_ARENA_SIDE));
      fireEvent.change(side, { target: { value: String(MIN_ARENA_SIDE - 1) } });
      expect(onSettings).not.toHaveBeenCalled();
      expect(side.getAttribute("aria-invalid")).toBe("true");
      fireEvent.change(side, { target: { value: String(MIN_ARENA_SIDE) } });
      expect(onSettings).toHaveBeenCalledTimes(1);
      onSettings.mockClear();
    }
  });

  // The echo is the source of truth for every knob the host has not typed into — including for a
  // player promoted to host mid-lobby, whose draft of the rest of the world is nothing at all.
  test("a knob the host has not typed into follows the session's settings", () => {
    const { rerender } = render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /^nests$/i }), {
      target: { value: "9" },
    });
    rerender(
      <LobbyScreen
        state={asHost({
          settings: withKnob(DEFAULT_WORLD_SETTINGS, "enemyCap", 42) as WorldSettings,
        })}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect((screen.getByRole("spinbutton", { name: /enemy cap/i }) as HTMLInputElement).value).toBe(
      "42",
    );
    expect((screen.getByRole("spinbutton", { name: /^nests$/i }) as HTMLInputElement).value).toBe(
      "9",
    );
  });

  // Three numbers describing one escalation curve are one thing, and a flat list says otherwise —
  // tabbing them gives a screen reader three unrelated fields. The fence is what carries the
  // relationship, so it is asserted by the name a group is announced under, not by the markup.
  test("the numbers of one curve are fenced together under a name", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    for (const [legend, count] of [
      [/^arena$/i, 2],
      [/^nest period$/i, 3],
      [/^wave size$/i, 3],
      [/^elite share$/i, 2],
    ] as const) {
      const group = screen.getByRole("group", { name: legend });
      expect(within(group).getAllByRole("spinbutton")).toHaveLength(count);
    }
  });

  // The fence must not reorder the form: the order is the settings' own, so a knob added to the middle
  // of a group later lands where the settings put it rather than where the screen's markup would.
  test("fencing leaves the controls in the order the settings give them", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    expect(controls().map((i) => i.name)).toEqual(worldKnobs().map((k) => k.path));
  });

  // `aria-invalid` alone announces "invalid entry" and leaves the why to be guessed. The server
  // refuses a payload whole rather than clamping it (ADR 0006), so the bounds are said in full — and
  // said on the page, so a sighted host reads the same reason a screen reader is given.
  test("a refused figure says why, and the field points at the saying", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const nests = screen.getByRole("spinbutton", { name: /^nests$/i }) as HTMLInputElement;
    fireEvent.change(nests, { target: { value: String(ceilingOf("nestCount") + 1) } });

    const saying = nests.getAttribute("aria-describedby");
    expect(saying).toBeTruthy();
    const said = document.getElementById(saying as string);
    expect(said?.textContent ?? "").toContain(String(ceilingOf("nestCount")));
    expect(said?.textContent ?? "").not.toBe("");
  });

  // Nothing is said about a field that is merely unfinished — a half-typed number is not yet wrong,
  // and announcing a reason for it would be noise on every keystroke.
  test("a half-typed figure is pointed at no saying at all", () => {
    render(
      <LobbyScreen
        state={asHost()}
        onLeave={mock()}
        onStart={mock()}
        onSettings={mock()}
        onTutorial={mock()}
      />,
    );
    const nests = screen.getByRole("spinbutton", { name: /^nests$/i }) as HTMLInputElement;
    fireEvent.change(nests, { target: { value: "" } });
    expect(nests.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/must be/i)).toBeNull();
  });
});

// #162. The lobby is where the sprite cache is warmed, because it is the one stretch of the app
// with time to spend and nothing being drawn. Without this, removing the call is silent: every
// other test on this screen passes with the warm-up gone.
//
// happy-dom returns null from `getContext('2d')`, which is exactly what `canBake` is there to
// notice, so the context is stubbed for the length of the test to get past that gate.
describe("warming the sprite cache (#162)", () => {
  const withCanvas = async (run: () => Promise<void> | void) => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const real = proto.getContext;
    proto.getContext = () => ({}) as CanvasRenderingContext2D;
    try {
      await run();
    } finally {
      proto.getContext = real;
    }
  };

  const spyingOnWarm = async (run: (calls: number[]) => Promise<void> | void) => {
    const calls: number[] = [];
    const real = spriteCache.warm;
    (spriteCache as { warm: SpriteCache["warm"] }).warm = (scale) => {
      calls.push(scale);
      return 0; // nothing left bare, so one turn is the whole of it
    };
    try {
      await run(calls);
    } finally {
      (spriteCache as { warm: SpriteCache["warm"] }).warm = real;
    }
  };

  test("starts warming while the squad is still gathering", async () => {
    await withCanvas(() =>
      spyingOnWarm(async (calls) => {
        render(
          <LobbyScreen
            state={state}
            onLeave={mock()}
            onStart={mock()}
            onSettings={mock()}
            onTutorial={mock()}
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(calls.length).toBeGreaterThan(0);
        // At the scale a match opens on, which is the only one a bake can cover (ADR 0008).
        expect(calls[0]).toBe(warmScale(window.devicePixelRatio || 1, ZOOM_DEFAULT));
      }),
    );
  });

  test("bakes nothing when there is nothing to bake into", async () => {
    await spyingOnWarm(async (calls) => {
      render(
        <LobbyScreen
          state={state}
          onLeave={mock()}
          onStart={mock()}
          onSettings={mock()}
          onTutorial={mock()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(calls).toEqual([]);
    });
  });

  test("stops when the lobby goes away, rather than baking into a match", async () => {
    await withCanvas(() =>
      spyingOnWarm(async (calls) => {
        const view = render(
          <LobbyScreen
            state={state}
            onLeave={mock()}
            onStart={mock()}
            onSettings={mock()}
            onTutorial={mock()}
          />,
        );
        view.unmount();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(calls).toEqual([]);
      }),
    );
  });
});
