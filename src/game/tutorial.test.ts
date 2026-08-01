import { beforeEach, describe, expect, test } from "bun:test";
import type { OreKind, Tile } from "../lobby/protocol";
import {
  BULLET_COST,
  freshBuildState,
  insertStructure,
  type OreGrid,
  TILE,
  tileKey,
} from "./build";
import {
  AMMO_WORDS,
  freshTutorial,
  GUN_WORDS,
  HAND_MINES_TAUGHT,
  loadLessons,
  METAL_WORDS,
  MINE_WORDS,
  observe,
  POWER_WORDS,
  SHOOT_WORDS,
  saveLessons,
  stepTutorial,
  TURRET_WORDS,
  type Tutorial,
  type TutorialScene,
} from "./tutorial";
import { ARENA } from "./world";

// The tutorial is a state machine and nothing else — six prompts, each owed until the thing it
// teaches has been done. Everything below runs it without React, without a canvas and without a
// clock, which is the whole point of it being its own module.

const ORE_TILE: Tile = { tx: 4, ty: 4 };
const POWER_TILE: Tile = { tx: 9, ty: 4 };

function grid(...cells: [Tile, OreKind][]): OreGrid {
  return new Map(cells.map(([tile, kind]) => [tileKey(tile), kind]));
}

const ORE = grid([ORE_TILE, "metal"], [POWER_TILE, "power"]);

// A frame with nothing in it: no Metal banked, no enemy, the cursor nowhere, and the camera over
// the corner of the arena where the ore above sits. Every test names only what it is about.
function scene(patch: Partial<TutorialScene> = {}): TutorialScene {
  return {
    metal: 0,
    enemies: 0,
    ore: ORE,
    build: freshBuildState(ARENA),
    self: { x: 0, y: 0 },
    camera: { x: 0, y: 0 },
    viewport: { width: 800, height: 600 },
    cursor: null,
    ...patch,
  };
}

const centreOf = (tile: Tile) => ({ x: tile.tx * TILE + TILE / 2, y: tile.ty * TILE + TILE / 2 });

// The words of a sentence, read straight through with the inline icons left out — which is exactly
// the ask's sentence with its two ⟨…⟩ placeholders struck out.
const spoken = (words: typeof TURRET_WORDS) =>
  words.filter((span) => typeof span === "string").join(" ");

describe("the words, verbatim", () => {
  // Compared against the literal text rather than against the constants the game reads, because a
  // test that imports the string it is checking passes for any string at all.
  test("prompt 1 says what the ask says", () => {
    expect(MINE_WORDS).toBe("mine to get metal");
  });

  test("prompt 2 says what the ask says", () => {
    expect(AMMO_WORDS).toBe("Click to build ammo. You will need it!");
  });

  test("prompt 3 says what the ask says, long and short", () => {
    expect(METAL_WORDS.taught).toBe("Metal. Mine with left click");
    expect(METAL_WORDS.learned).toBe("Metal");
  });

  test("prompt 4 says what the ask says", () => {
    expect(POWER_WORDS).toBe("Power ore. Place a generator here to extract electricity");
  });

  test("prompt 5 says what the ask says, with an icon in each of the two places", () => {
    expect(TURRET_WORDS).toEqual([
      "Turrets require energy. Build a",
      { icon: "generator" },
      "generator on top of",
      { icon: "ore-power" },
      "power ore in order to generate electricity",
    ]);
    expect(spoken(TURRET_WORDS)).toBe(
      "Turrets require energy. Build a generator on top of power ore in order to generate electricity",
    );
  });

  test("prompt 6 says what the ask says", () => {
    expect(GUN_WORDS).toBe("Press G to equip/unequip your gun");
    expect(SHOOT_WORDS).toBe("Left click to shoot");
  });
});

describe("prompt 1 — highlight an ore", () => {
  test("marks the nearest metal ore on screen from the first frame, with no condition", () => {
    const view = stepTutorial(freshTutorial(), scene());
    expect(view.ore).toEqual({ tile: ORE_TILE, words: MINE_WORDS });
  });

  test("marks the metal nearest the player, never the power ore beside it", () => {
    const near: Tile = { tx: 20, ty: 4 };
    const view = stepTutorial(
      freshTutorial(),
      scene({
        ore: grid([ORE_TILE, "metal"], [POWER_TILE, "power"], [near, "metal"]),
        self: centreOf(near),
      }),
    );
    expect(view.ore?.tile).toEqual(near);
  });

  test("marks nothing where no metal is on screen, rather than pointing off it", () => {
    const view = stepTutorial(freshTutorial(), scene({ ore: grid([POWER_TILE, "power"]) }));
    expect(view.ore).toBeNull();
  });

  test("never marks ore a building already stands on", () => {
    const build = freshBuildState(ARENA);
    insertStructure(build, { id: "b1", kind: "miner", tile: ORE_TILE, hp: 1 });
    expect(stepTutorial(freshTutorial(), scene({ build })).ore).toBeNull();
  });

  test("ends when the player mines, and never comes back", () => {
    const tutorial = freshTutorial();
    expect(stepTutorial(tutorial, scene()).ore).not.toBeNull();
    observe(tutorial, { did: "mine" });
    expect(stepTutorial(tutorial, scene()).ore).toBeNull();
  });
});

describe("prompt 2 — highlight ammo at 5 Metal", () => {
  test("says nothing until the shared bank crosses one bullet's worth", () => {
    const tutorial = freshTutorial();
    expect(stepTutorial(tutorial, scene({ metal: BULLET_COST - 1 })).ammo).toBeNull();
    expect(stepTutorial(tutorial, scene({ metal: BULLET_COST })).ammo).toBe(AMMO_WORDS);
  });

  test("stays up once the bank has crossed, even if the squad spends back below it", () => {
    const tutorial = freshTutorial();
    stepTutorial(tutorial, scene({ metal: BULLET_COST }));
    expect(stepTutorial(tutorial, scene({ metal: 0 })).ammo).toBe(AMMO_WORDS);
  });

  test("ends when the player builds ammo", () => {
    const tutorial = freshTutorial();
    stepTutorial(tutorial, scene({ metal: BULLET_COST }));
    observe(tutorial, { did: "forge" });
    expect(stepTutorial(tutorial, scene({ metal: BULLET_COST })).ammo).toBeNull();
  });
});

describe("prompt 3 — the metal ore tooltip", () => {
  const overOre = scene({ cursor: centreOf(ORE_TILE) });

  test("shows the long form while hovering metal ore", () => {
    expect(stepTutorial(freshTutorial(), overOre).cursor).toEqual({
      at: overOre.cursor as { x: number; y: number },
      words: METAL_WORDS.taught,
    });
  });

  test("ends when the cursor leaves — nothing is up with no cursor on the arena", () => {
    expect(stepTutorial(freshTutorial(), scene({ cursor: null })).cursor).toBeNull();
  });

  test("drops to the short form once this player has hand-mined three Metal", () => {
    const tutorial = freshTutorial();
    for (let i = 0; i < HAND_MINES_TAUGHT - 1; i++) observe(tutorial, { did: "mine" });
    expect(stepTutorial(tutorial, overOre).cursor?.words).toBe(METAL_WORDS.taught);
    observe(tutorial, { did: "mine" });
    expect(stepTutorial(tutorial, overOre).cursor?.words).toBe(METAL_WORDS.learned);
  });

  test("a teammate's mining is not this client's, so nothing but its own count moves it", () => {
    // There is no event for a teammate to raise: the count rides #130's client-local at-zero
    // event, which only ever fires on the client whose own hand took the tile to nothing. Three
    // Metal that arrived in the shared bank from anywhere else leaves the long form standing.
    const tutorial = freshTutorial();
    expect(stepTutorial(tutorial, { ...overOre, metal: 300 }).cursor?.words).toBe(
      METAL_WORDS.taught,
    );
  });

  test("says nothing over bare ground", () => {
    expect(stepTutorial(freshTutorial(), scene({ cursor: { x: 600, y: 600 } })).cursor).toBeNull();
  });

  test("says nothing about ore a building stands on", () => {
    const build = freshBuildState(ARENA);
    insertStructure(build, { id: "b1", kind: "miner", tile: ORE_TILE, hp: 1 });
    expect(stepTutorial(freshTutorial(), { ...overOre, build }).cursor).toBeNull();
  });
});

describe("prompt 4 — the power ore tooltip", () => {
  test("shows while hovering power ore, whatever the player has already learned", () => {
    const tutorial = freshTutorial();
    for (let i = 0; i < HAND_MINES_TAUGHT; i++) observe(tutorial, { did: "mine" });
    observe(tutorial, { did: "build", kind: "generator", tile: POWER_TILE });
    expect(stepTutorial(tutorial, scene({ cursor: centreOf(POWER_TILE) })).cursor?.words).toBe(
      POWER_WORDS,
    );
  });
});

describe("prompt 5 — the first turret", () => {
  const TURRET_TILE: Tile = { tx: 12, ty: 12 };
  const standing = () => {
    const build = freshBuildState(ARENA);
    insertStructure(build, { id: "b1", kind: "turret", tile: TURRET_TILE, hp: 1 });
    return build;
  };

  test("raises the tooltip over the turret the player just placed", () => {
    const tutorial = freshTutorial();
    observe(tutorial, { did: "build", kind: "turret", tile: TURRET_TILE });
    expect(stepTutorial(tutorial, scene({ build: standing() })).turret).toEqual({
      tile: TURRET_TILE,
      words: TURRET_WORDS,
    });
  });

  test("stays over the first turret when a second goes up", () => {
    const tutorial = freshTutorial();
    observe(tutorial, { did: "build", kind: "turret", tile: TURRET_TILE });
    observe(tutorial, { did: "build", kind: "turret", tile: { tx: 40, ty: 40 } });
    expect(stepTutorial(tutorial, scene({ build: standing() })).turret?.tile).toEqual(TURRET_TILE);
  });

  test("ends when the player builds a generator", () => {
    const tutorial = freshTutorial();
    observe(tutorial, { did: "build", kind: "turret", tile: TURRET_TILE });
    observe(tutorial, { did: "build", kind: "generator", tile: POWER_TILE });
    expect(stepTutorial(tutorial, scene({ build: standing() })).turret).toBeNull();
  });

  // The client places without waiting for the server, so for a round trip after the press there is
  // nothing standing on the tile in the mirrored world. A prompt that read the mirror straight would
  // blink out on the very frame it was raised, and never come back.
  test("stays up while the placement is still in flight", () => {
    const tutorial = freshTutorial();
    observe(tutorial, { did: "build", kind: "turret", tile: TURRET_TILE });
    expect(stepTutorial(tutorial, scene({ build: freshBuildState(ARENA) })).turret?.tile).toEqual(
      TURRET_TILE,
    );
    expect(stepTutorial(tutorial, scene({ build: standing() })).turret?.tile).toEqual(TURRET_TILE);
  });

  test("goes with the turret if that turret comes down first", () => {
    const tutorial = freshTutorial();
    observe(tutorial, { did: "build", kind: "turret", tile: TURRET_TILE });
    stepTutorial(tutorial, scene({ build: standing() })); // the server's delta lands it
    expect(stepTutorial(tutorial, scene({ build: freshBuildState(ARENA) })).turret).toBeNull();
  });

  test("a teammate's turret raises nothing — only this client's own placements are seen", () => {
    expect(stepTutorial(freshTutorial(), scene({ build: standing() })).turret).toBeNull();
  });
});

describe("prompt 6 — the first enemy", () => {
  test("says nothing until an enemy has appeared on this client", () => {
    expect(stepTutorial(freshTutorial(), scene()).banner).toBeNull();
  });

  test("names the gun key once one has", () => {
    expect(stepTutorial(freshTutorial(), scene({ enemies: 1 })).banner).toBe(GUN_WORDS);
  });

  test("stays up after the enemy is gone again", () => {
    const tutorial = freshTutorial();
    stepTutorial(tutorial, scene({ enemies: 1 }));
    expect(stepTutorial(tutorial, scene({ enemies: 0 })).banner).toBe(GUN_WORDS);
  });

  test("turns into the shooting prompt on the keypress it waits for", () => {
    const tutorial = freshTutorial();
    stepTutorial(tutorial, scene({ enemies: 1 }));
    observe(tutorial, { did: "equip" });
    expect(stepTutorial(tutorial, scene({ enemies: 1 })).banner).toBe(SHOOT_WORDS);
  });

  test("and ends when the player shoots", () => {
    const tutorial = freshTutorial();
    stepTutorial(tutorial, scene({ enemies: 1 }));
    observe(tutorial, { did: "equip" });
    observe(tutorial, { did: "shoot" });
    expect(stepTutorial(tutorial, scene({ enemies: 1 })).banner).toBeNull();
  });
});

describe("seen once ever", () => {
  beforeEach(() => localStorage.clear());

  test("a lesson that has landed is never taught again on a fresh tutorial", () => {
    const first = freshTutorial();
    observe(first, { did: "mine" });
    observe(first, { did: "forge" });
    saveLessons(first);

    const second = freshTutorial(loadLessons());
    const view = stepTutorial(second, scene({ metal: BULLET_COST }));
    expect(view.ore).toBeNull();
    expect(view.ammo).toBeNull();
  });

  test("three hand-mined Metal survive the match they were mined in", () => {
    const first = freshTutorial();
    for (let i = 0; i < HAND_MINES_TAUGHT; i++) observe(first, { did: "mine" });
    saveLessons(first);

    const second = freshTutorial(loadLessons());
    expect(stepTutorial(second, scene({ cursor: centreOf(ORE_TILE) })).cursor?.words).toBe(
      METAL_WORDS.learned,
    );
  });

  test("only a landed lesson is written down", () => {
    const tutorial = freshTutorial();
    expect(observe(tutorial, { did: "mine" })).toBe(true);
    expect(observe(tutorial, { did: "mine" })).toBe(false); // already learned; nothing to persist
  });

  test("with no store to read, the tutorial shows rather than being suppressed", () => {
    // Failing toward teaching: a browser that refuses `localStorage` — privacy mode, or none at
    // all — must not read as "this player has seen everything".
    const store = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(loadLessons()).toEqual([]);
      expect(() => saveLessons(freshTutorial())).not.toThrow();
      expect(stepTutorial(freshTutorial(loadLessons()), scene()).ore).not.toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
    }
  });

  test("a store holding nonsense teaches the whole tutorial rather than half of it", () => {
    localStorage.setItem("tutorial:learned", '["not-a-lesson", 7, null]');
    const tutorial: Tutorial = freshTutorial(loadLessons());
    expect(stepTutorial(tutorial, scene()).ore).not.toBeNull();
  });
});
