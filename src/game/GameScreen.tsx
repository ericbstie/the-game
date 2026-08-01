import { useCallback, useEffect, useRef, useState } from "react";
import type { LobbyState } from "../lobby/client";
import type { Arena, BuildableKind, MoveInput, PlayerId, Tile, Vec2 } from "../lobby/protocol";
import { createSpriteCache } from "../sprite/cache";
import reconnectingIcon from "../sprite/reconnecting";
import { SPRITES } from "../sprite/registry";
import { SpriteIcon } from "../sprite/SpriteIcon";
import warningIcon from "../sprite/warning";
import {
  BUILD_CADENCE_MS,
  BUILD_SLOTS,
  BUILDABLES,
  FORGE_MS,
  type HarvestTarget,
  INTERACT_REACH,
  placementError,
  resolveHarvest,
  tileCenter,
  tileOf,
  tilesBetween,
  withinReach,
} from "./build";
import { type Camera, computeCamera } from "./camera";
import { type ClientWorld, RESPAWN_DELAY_MS } from "./clientWorld";
import { damageFx } from "./damageFx";
import { BURST_MS, type BuildGhost, drawWorld, type OwnShot, PUFF_MS, SHOT_LINE_MS } from "./draw";
import { RANGED_CADENCE_MS } from "./enemies";
import { freshMetalFloats, stepMetalFloats } from "./floats";
import { freshHarvest, stepHarvest } from "./harvest";
import {
  aimDir,
  isGunToggleKey,
  isMinimapZoomKey,
  keyToBuildSlot,
  keyToDirection,
  movesEqual,
  NO_MOVE,
} from "./input";
import { MINIMAP_COVERAGE_U, nextMinimapCoverage } from "./minimap";
import { PLAYER_MAX_HP } from "./world";

const POS_SEND_MS = 50; // ~20 Hz position stream, independent of the render frame rate
const MAX_FRAME_MS = 100; // cap dt so a backgrounded tab doesn't teleport the avatar on resume
// How long after the last bite a structure still counts as under attack. Comfortably longer than a
// spider's bite cadence, so a base being chewed holds the warning steady rather than strobing it
// between bites, and short enough that the bell stops soon after the last spider is off it.
const UNDER_ATTACK_MS = 2000;
const BUILD_ICON_PX = 26; // the buildable's own sprite, shrunk to fit a slot
const AMMO_ICON_PX = 26; // the ammo box's icon, sized as a build slot's so the two squares agree
const GUN_ICON_PX = 26; // and the gun's, so every icon plate on the HUD is one square
const ammoIcon = SPRITES.ammo;
const gunIcon = SPRITES.gun;
// What a slot is called on screen (#98) — the author's wording, one word each. `mine` is the label
// for a `miner`: a display string, so the domain type keeps the name the whole build path uses.
const BUILD_NAMES: Record<BuildableKind, string> = {
  miner: "mine",
  wall: "wall",
  turret: "turret",
  generator: "generator",
};

// Every slot's live Metal price, in bar order. A turret's climbs with the squad's standing turrets
// (#101), so the circle is mirrored from the world on the HUD's timer rather than read once.
// Before the world exists the squad has nothing standing, which is exactly the registry price.
const slotCosts = (world: ClientWorld | undefined): number[] =>
  BUILD_SLOTS.map((kind) => world?.buildCost(kind) ?? BUILDABLES[kind]?.cost ?? 0);

// One cache for the app: a baked sprite depends on the display, not on which screen is mounted.
// It bakes nothing until something is drawn, so importing this costs nothing under `bun test`,
// where there is no canvas to bake into.
const spriteCache = createSpriteCache(SPRITES);

// A run of buildables being laid by a held left-click (#104). `at` is the far end of the path the
// cursor has walked, so each pointer sample only has to fill the gap since the last one; `pending`
// is what that path has crossed and the build cadence has not yet let out. `kind` is latched at the
// press rather than read live, because taking the build bar mid-drag must not lay the other thing
// on tiles that were crossed before it was chosen.
//
// `next` is the read cursor rather than `shift`: the queue is deliberately unbounded — every tile in
// it was asked for — and a drain that shifted would cost O(n) a tile, which a gesture jittering over
// a tile a structure already stands on pays in one synchronous frame. Consumed entries are left
// where they are; the whole array goes when the button does.
interface BuildDrag {
  kind: BuildableKind;
  at: Tile;
  pending: Tile[];
  next: number;
  lastAt: number;
}

interface GameScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onPos: (pos: Vec2) => void;
  onAttack: (pos: Vec2, dir: Vec2) => void;
  onHealth: (hp: number) => void;
  onMine: (tile: Tile) => void;
  onBuild: (kind: BuildableKind, tile: Tile) => void;
  onDemolish: (id: string) => void;
  onForge: () => void;
}

// The in-match screen: a fullscreen camera that follows your Avatar through the giant box.
// A single render loop integrates the owner locally each frame (zero input lag), samples
// peers render-delay behind from their buffers, clamps the camera at the walls, culls
// off-screen entities, and paints via a DPR-correct transform (1 world unit = 1 CSS px,
// crisp on HiDPI). The owner's position streams out at a fixed ~20 Hz. Refs bridge React's
// render into the loop so a world swapped on reconnect and a changed callback are picked up
// without restarting it.
export function GameScreen({
  state,
  onLeave,
  onPos,
  onAttack,
  onHealth,
  onMine,
  onBuild,
  onDemolish,
  onForge,
}: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef<MoveInput>(NO_MOVE);
  const worldRef = useRef(state.world);
  const selfIdRef = useRef(state.self?.id);
  const connectedRef = useRef<ReadonlySet<PlayerId>>(new Set());
  const onPosRef = useRef(onPos);
  const onAttackRef = useRef(onAttack);
  const onHealthRef = useRef(onHealth);
  const onMineRef = useRef(onMine);
  const onBuildRef = useRef(onBuild);
  const onDemolishRef = useRef(onDemolish);
  // Whether right-click is down. A plain flag: how long it has been held is no longer this ref's
  // business — the building's own harvest progress is what the hold is spent on (#130).
  const demolishingRef = useRef(false);
  // Whether left-click is down on an empty build bar. What that *does* is not latched here: the gun
  // decides, and it is read live every tick, so `g` mid-hold switches the hold between the trigger
  // (#103) and the pick without the button being let go (#120). A flag rather than the demolish
  // hold's timestamp: neither job cares how long it has been down.
  const leftHeldRef = useRef(false);
  // The run left-click is dragging out, or null if it is not (#104). Never live at the same time as
  // `leftHeldRef`: the press reads the build bar once and arms exactly one of the two.
  const dragRef = useRef<BuildDrag | null>(null);
  // When the last shot actually went out. The cadence is enforced here as well as in the server's
  // `admitAttack` because a fast-clicking player would otherwise send, and draw a line for, shots
  // the server refused. A drawn line must never imply damage nobody applied.
  //
  // Exactly `RANGED_CADENCE_MS`, not a hair more: the server measures arrival-to-arrival where
  // this measures shot-to-shot, so a shot sent right on the boundary can still land early under
  // negative jitter and be refused. Widening the gate here would cut the sustained rate of fire.
  // The boundary case is accepted.
  const lastAttackRef = useRef(Number.NEGATIVE_INFINITY);
  // Your own last shot, kept so its line can be drawn from here rather than from the relay the
  // server sends back to the whole squad. `drawWorld` ages it; nothing has to clear it.
  const ownShotRef = useRef<OwnShot | null>(null);
  // The `+1`s the squad's miners are throwing up (#99). Client-derived from the mirrored structure
  // set, so it lives with the loop that draws it rather than on the wire or in `ClientWorld` — the
  // beat is the same one the bank is paid on, but which miners *emit* is a question about the camera.
  const floatsRef = useRef(freshMetalFloats());
  // How much of whatever is under the cursor this player has dug out or pulled down (#130). One
  // pair, client-local: it never rides the wire, so a teammate on the same tile is digging their
  // own, and it is dropped the moment the button comes up.
  const harvestRef = useRef(freshHarvest());
  // How much world the corner map is showing (#110). A ref and not state: it is read by the frame
  // that draws it and by nothing else, so a re-render per press would buy the HUD nothing.
  const minimapCoverageRef = useRef(MINIMAP_COVERAGE_U);
  const [selected, setSelected] = useState<BuildableKind | null>(null);
  const selectedRef = useRef(selected); // the render loop and the click handler read it un-stale
  // Whether the gun is up (#120). React state because the HUD's icon is drawn from it, and a ref
  // beside it because the render loop and the mine loop both read it between renders.
  const [equipped, setEquipped] = useState(false); // you spawn with it stowed
  const equippedRef = useRef(equipped);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(menuOpen); // the key listener reads it un-stale, as it does the selection
  const menuRef = useRef<HTMLDialogElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const [hp, setHp] = useState(PLAYER_MAX_HP); // mirrored into React only to drive the HUD
  const [metal, setMetal] = useState(0); // the shared bank, mirrored into React for the HUD
  const [metalRate, setMetalRate] = useState(0); // shown on the reveal behind the total (#105)
  const [power, setPower] = useState({ generation: 0, consumption: 0 }); // the live energy rate
  const [costs, setCosts] = useState(() => slotCosts(state.world)); // the build bar's cost circles
  const [ammo, setAmmo] = useState({ bullets: 0, queued: 0, forgeAt: null as number | null }); // #102
  const [underAttack, setUnderAttack] = useState(false); // drives the HUD's warning bell
  const viewRef = useRef({ w: 0, h: 0, dpr: 1 }); // CSS viewport size + device pixel ratio
  const pointerRef = useRef<Vec2>({ x: 0, y: 0 }); // latest pointer, CSS px within the canvas
  const aimRef = useRef<{ camera: Camera; self: Vec2 }>({
    camera: { x: 0, y: 0 },
    self: { x: 0, y: 0 },
  }); // the render loop's latest camera + self world pos, so a click aims from the true origin
  worldRef.current = state.world;
  selfIdRef.current = state.self?.id;
  // Who is actually at the keyboard, for the off-screen arrows (#94). Rebuilt on a React render
  // rather than in the loop: the roster moves when a socket does, which is a handful of times a
  // match, and the frame that reads it is running at 60 Hz.
  connectedRef.current = new Set(
    state.snapshot?.players.filter((p) => p.presence.status === "connected").map((p) => p.id),
  );
  onPosRef.current = onPos;
  onAttackRef.current = onAttack;
  onHealthRef.current = onHealth;
  onMineRef.current = onMine;
  onBuildRef.current = onBuild;
  onDemolishRef.current = onDemolish;
  selectedRef.current = selected;
  equippedRef.current = equipped;
  menuOpenRef.current = menuOpen;

  // Keyboard → held MoveInput, plus the build bar's 1–4, the menu's Escape and the map's zoom.
  // Nothing is sent per key.
  useEffect(() => {
    const setHeld = (direction: keyof MoveInput, down: boolean) => {
      const next = { ...heldRef.current, [direction]: down };
      if (movesEqual(next, heldRef.current)) return; // only react to a real change
      heldRef.current = next;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A shown `<dialog>` closes itself on an Escape the page did not consume, which would fight
        // this for the same key. Cancelling the event suppresses that close request and leaves the
        // menu's open state to exactly one owner.
        e.preventDefault();
        // An open menu answers first, before anything else Escape does (#117). `1`–`4` still reach
        // this listener from behind the modal, so a selection taken there would otherwise eat the
        // key the menu is closed with. Only with the menu down does Escape cancel the selected
        // buildable, and only with nothing to cancel does it open the menu.
        if (menuOpenRef.current) setMenuOpen(false);
        else if (selectedRef.current) {
          selectedRef.current = null; // the ghost must go this frame, not on the next render
          setSelected(null);
        } else setMenuOpen(true);
        return;
      }
      const slot = keyToBuildSlot(e.key, BUILD_SLOTS.length);
      if (slot !== null) {
        setSelected(BUILD_SLOTS[slot]);
        return;
      }
      if (isGunToggleKey(e.key)) {
        // Guarded against key repeat for the reason the map's zoom is, and harder: a toggle stepped
        // at the OS's ~30 Hz would flap the gun and settle on whichever side the key came up on.
        // The ref moves first, because a hold already down switches on the very next tick and must
        // not wait for React to render what it switched to.
        if (!e.repeat) {
          equippedRef.current = !equippedRef.current;
          setEquipped(equippedRef.current);
        }
        return;
      }
      if (isMinimapZoomKey(e.key)) {
        // One press, one level. The OS repeats a held key at ~30 Hz, and a cycle stepped by each of
        // those would spin the map through ten levels a second — the build bar takes no harm from
        // repeats because picking the same slot twice picks the same slot.
        if (!e.repeat) minimapCoverageRef.current = nextMinimapCoverage(minimapCoverageRef.current);
        return;
      }
      const direction = keyToDirection(e.key);
      if (!direction) return;
      e.preventDefault(); // arrow keys otherwise scroll the page
      setHeld(direction, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const direction = keyToDirection(e.key);
      if (!direction) return;
      setHeld(direction, false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // The menu is a real modal — `showModal` is what puts it in the top layer and makes the match
  // behind it inert to the pointer — over a match that is still running. Nothing pauses: the
  // world is server-authoritative and the squad is still playing, so the only thing opening it
  // changes is that held movement is let go and you stand still.
  useEffect(() => {
    if (!menuOpen) return;
    heldRef.current = NO_MOVE;
    // The left hold goes with it (#103). Escape brings no `mouseup`, so a hold armed before the
    // menu opened would keep firing — or mining (#120) — behind it at whatever the pointer was
    // last over.
    leftHeldRef.current = false;
    dragRef.current = null; // and the run with it, for the same want of a `mouseup` (#104)
    menuRef.current?.showModal();
    // Focus is placed rather than left to `showModal`'s own focusing step, which not every DOM
    // implements. Escape has no invoking element to hand focus back to on close, so it goes to the
    // arena — the surface the menu was opened over, and where the keys were already going.
    leaveRef.current?.focus();
    return () => canvasRef.current?.focus();
  }, [menuOpen]);

  // One shot, or none. A click and a held trigger both come through here, so the cadence is spent
  // in exactly one place and a held shot is indistinguishable from a clicked one. It reads nothing
  // but refs, so it is stable for the life of the match and the render loop below can hold it.
  //
  // The gap is measured shot-to-shot off the clock rather than counted in ticks: a long frame
  // delays the next shot instead of letting two through, and no accumulator survives a stall to
  // pay its backlog out as a burst. Two shots are therefore never closer than the floor
  // `admitAttack` enforces — the property that keeps a drawn line from outrunning admission (#85).
  const fireIfDue = useCallback((now: number) => {
    const world = worldRef.current;
    if (!world) return;
    // Dying drops the trigger rather than merely refusing to pull it. The cadence gate is measured
    // against the last real shot, and `RESPAWN_DELAY_MS` is forty times it, so a button still held
    // while waiting — the natural thing to do — would satisfy the gate the instant you stood up and
    // send a shot nobody asked for. Coming back up takes a fresh press, as it did when firing was a
    // discrete click.
    //
    // This is the only thing that drops the left hold on a death, so it drops it only while the gun
    // is up. A stowed hold stays armed and is merely refused — `liveHarvest` answers null for a corpse
    // — and that is observable, not theoretical: `reviveSelf` respawns at arena centre
    // (clientWorld.ts:244) and `BOOTSTRAP_PATCHES` seeds metal patches there (build.ts:110), well
    // inside `INTERACT_REACH`, so a button held through a death can be mining again the moment you
    // stand up. Kept because it is what mining did on its old button, not because it is invisible.
    if (world.isDead()) {
      leftHeldRef.current = false;
      return;
    }
    // A selected buildable makes left-click a placement (#104). Read before the cadence, so holding
    // over the build bar never spends it and costs the first shot after the bar is cleared.
    if (selectedRef.current) return;
    // A shot spends a bullet from the squad's pool, and the server refuses one it cannot pay for
    // (#102). Read before the cadence for the same reason the build bar is: an empty pool must not
    // cost the first shot after a bullet lands. The mirror is at worst one tick behind the pool it
    // is gating on, so two players racing for the last bullet can still both draw — the same
    // boundary the cadence gate already accepts, and the only case a round-trip could close.
    if (world.ammo() <= 0) return;
    if (now - lastAttackRef.current < RANGED_CADENCE_MS) return;
    lastAttackRef.current = now;
    const { camera, self } = aimRef.current;
    const dir = aimDir(pointerRef.current, self, camera);
    ownShotRef.current = { at: now, from: { ...self }, dir };
    onAttackRef.current({ ...self }, dir);
  }, []);

  // One placement out of the drag's queue, or none. The press and the held frames both come through
  // here, so a run is paced in exactly one place — `BUILD_CADENCE_MS` is `admitBuild`'s own floor,
  // and a client that outran it would have most of what it sent dropped and lay a run full of holes.
  //
  // The queue is what makes a fast drag whole: the pointer crosses tiles far quicker than ten a
  // second, so they wait here rather than being lost to the sample that overtook them.
  const placeIfDue = useCallback((now: number) => {
    const drag = dragRef.current;
    const world = worldRef.current;
    if (!drag || !world) return;
    // The build bar taken mid-drag ends the gesture rather than switching what it lays. Every tile
    // still queued was crossed while the old kind was up, and the new one was never asked for there.
    if (selectedRef.current !== drag.kind) {
      dragRef.current = null;
      return;
    }
    if (now - drag.lastAt < BUILD_CADENCE_MS) return;
    while (drag.next < drag.pending.length) {
      const tile = drag.pending[drag.next++];
      // The same rule the ghost paints and the server admits on, read off the mirrored bank — so a
      // turret's price climbing under its own run (#101) is felt here as the run is laid.
      const refusal = placementError(drag.kind, tile, world.ore, world.build, aimRef.current.self);
      // Cost is the one refusal that ends the gesture instead of being stepped over. Anything else
      // is a tile the run passes through, and stepping over it spends no cadence — a wall's 2×2
      // footprint blocks the tile after every one it lays, and paying a cadence for each of those
      // would halve the speed of every straight drag.
      if (refusal === "unaffordable") {
        dragRef.current = null;
        return;
      }
      if (refusal !== null) continue;
      drag.lastAt = now;
      onBuildRef.current(drag.kind, tile);
      return;
    }
  }, []);

  // Track the CSS viewport size and size the backing store to device pixels (crisp HiDPI).
  // ResizeObserver reports content-box changes without a per-frame layout read; the loop
  // handles a pure DPR change (moving to a different-density monitor) itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sync = () => sizeBackingStore(canvas, viewRef);
    sync();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(sync);
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      const canvas = canvasRef.current;
      const world = worldRef.current;
      if (canvas && world) {
        const dpr = window.devicePixelRatio || 1;
        if (dpr !== viewRef.current.dpr) resizeForDpr(canvas, viewRef, dpr);
        // One clock for the whole frame. `snapshot` advances each entity's gait on the `now` it is
        // given, and the shot lines resolve their targets against the same interpolation it renders
        // on — reading the clock twice would split that step and land a line off its own sprite.
        const clock = Date.now();
        // What the held buttons are harvesting this frame, or null. One answer for both of them,
        // because one tile is never two things: a structure under the cursor is a demolish and the
        // ore beneath it is unreachable until it is gone (`resolveHarvest`). Read fresh every frame
        // rather than latched, so it takes hold on the very frame a button goes down and is gone on
        // the frame it comes up — with no stale flag for a blur, a death or the gun coming up to
        // strand.
        const target = liveHarvest(
          world,
          leftHeldRef.current && !equippedRef.current,
          demolishingRef.current,
          selectedRef.current,
          pointerRef.current,
          aimRef.current.camera,
        );
        // Hand-mining pins you where you stand (#109); pulling a building down does not.
        const move = target?.kind === "mine" ? NO_MOVE : heldRef.current;
        if (!world.isDead()) world.stepSelf(dt, move, clock); // a downed player holds still
        world.updateHealth(clock); // judge contact damage at the owner's true position
        // The frame's own delta is what the harvest is spent from, so progress runs at the rate the
        // button was held for rather than at whatever cadence a message stream happened to have. It
        // is the avatar's clamped `dt`, deliberately and not by accident: below 10 fps you harvest
        // slower than the wall clock, which is the price of the alternative being a stalled tab
        // coming back and paying out every harvest it slept through at once. The server hears
        // nothing until one completes, and `harvested` is where anything else that wants to know
        // hangs off: a `+1` on the crossing (#136), sparks on the ore (#107, #78). It is a value, so
        // a second consumer is a second reader of it and costs the harvest nothing.
        const harvested = stepHarvest(harvestRef.current, target, dt);
        if (harvested?.kind === "mine") onMineRef.current(harvested.tile);
        if (harvested?.kind === "demolish") onDemolishRef.current(harvested.id);
        // Held left-click is one of three things and never two of them at once: a run of buildables
        // when the bar has one selected (#104), a shot with the gun up (#103), a mine with it stowed
        // (#120) — that last one already spent, above, out of the same frame the other two are
        // charged against. All three are outside the draw, so a frame that renders nothing still
        // keeps their rates honest.
        if (leftHeldRef.current && equippedRef.current) fireIfDue(clock);
        if (dragRef.current) placeIfDue(clock);
        const { w, h } = viewRef.current;
        const ctx = w > 0 && h > 0 ? canvas.getContext("2d") : null;
        if (ctx) {
          const snapshot = world.snapshot(clock);
          const self = selfPos(snapshot.players, selfIdRef.current) ?? center(world.arena);
          const viewport = { width: w, height: h };
          const camera = computeCamera(self, viewport, world.arena);
          aimRef.current = { camera, self }; // feed the attack handlers the live origin + camera
          // What a blow you took does to the screen (#142). The swing is applied to the camera the
          // world is *painted* from and to nothing else: `aimRef` above keeps the true one, so a
          // shaking screen never moves where a click lands or which tile the cursor is over. Every
          // consumer inside `drawWorld` — the clear, the paper, the cull, the pixel snap and the
          // corner map — follows the swing, or the frame would be painted through one camera and
          // bounded by another.
          //
          // `stepMetalFloats` below is the one consumer outside it, and it is handed the true
          // camera deliberately: its cull decides whether a `+1` is ever *spawned*, and a crossing
          // it drops is dropped for good (`floats.ts`). A swing of `SHAKE_REACH` may not decide
          // that — and it has nothing to decide, being well inside the 15-unit pad the cull already
          // carries for a miner's own footprint. A float that is spawned is then painted through
          // `view` with everything else.
          const fx = damageFx(clock - world.damagedAt());
          const view = { x: camera.x + fx.shake.x, y: camera.y + fx.shake.y };
          ctx.setTransform(dpr, 0, 0, dpr, -view.x * dpr, -view.y * dpr);
          const kind = selectedRef.current;
          const ghost: BuildGhost | undefined = kind
            ? {
                kind,
                tile: cursorTile(pointerRef.current, camera),
                // The ghost runs the very rule the server will: same registry, same ore, same
                // mirrored build state — so green never turns into a rejected placement.
                valid:
                  placementError(
                    kind,
                    cursorTile(pointerRef.current, camera),
                    world.ore,
                    world.build,
                    self,
                  ) === null,
              }
            : undefined;
          // Asking the cache for this frame's DPR is also what re-bakes the set when the window
          // moves to a display of a different density: every bake in hand is then the wrong
          // resolution, and the cache empties itself rather than being told to.
          drawWorld(ctx, snapshot, {
            selfId: selfIdRef.current,
            camera: view,
            viewport,
            ghost,
            dpr,
            damageFlash: fx.flash,
            minimapCoverage: minimapCoverageRef.current,
            connected: connectedRef.current,
            now: clock,
            floats: stepMetalFloats(
              floatsRef.current,
              snapshot.structures,
              camera,
              viewport,
              clock,
            ),
            // Aged to the burst's own lifetime, on the same frame clock the snapshot above was
            // taken on — `impactMarks` is what puts the enemy render delay between the two, so a
            // burst and the spider it was struck on come out of one instant (#115).
            bursts: world.impactMarks(clock, BURST_MS),
            // Aged the same way, on the same frame clock, and judged without that delay — a death
            // takes its spider off this very snapshot, so the puff has nothing to wait for (#116).
            puffs: world.deathMarks(clock, PUFF_MS),
            sprites: spriteCache.source(dpr),
            shots: {
              // Aged to the line's own lifetime, never to the buffer's longer retention window.
              peers: world.peerShots(clock, SHOT_LINE_MS),
              own: ownShotRef.current,
              resolve: (id) => world.shotTargetPos(id, clock),
              ammo: world.ammo(),
            },
          });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fireIfDue, placeIfDue]);

  useEffect(() => {
    let lastHp = PLAYER_MAX_HP;
    let deadSince: number | null = null;
    const timer = setInterval(() => {
      const world = worldRef.current;
      if (!world) return;
      const now = Date.now();
      // Client-run respawn: after the delay, snap back to center at full HP. The countdown is no
      // longer shown — ADR 0001 took the text and granted it no icon — but the timer still runs.
      if (world.isDead()) {
        deadSince ??= now;
        if (now - deadSince >= RESPAWN_DELAY_MS) {
          world.reviveSelf();
          deadSince = null;
        }
      } else {
        deadSince = null;
      }
      setUnderAttack(world.structureUnderAttack(now, UNDER_ATTACK_MS));
      const nextHp = world.hp();
      if (nextHp !== lastHp) {
        lastHp = nextHp;
        setHp(nextHp); // repaint the HUD (rare — only on a health change)
        onHealthRef.current(nextHp); // report it; hp <= 0 declares death, max declares the revive
      }
      setMetal(world.metal()); // React bails out when the whole-metal readout hasn't moved
      setMetalRate(world.metalRate());
      const live = world.power();
      setPower((shown) =>
        shown.generation === live.generation && shown.consumption === live.consumption
          ? shown // same numbers: return the same object so React bails out of the re-render
          : { ...live },
      );
      setCosts((shown) => {
        const next = slotCosts(world);
        return next.every((cost, i) => cost === shown[i]) ? shown : next;
      });
      // Held as one object so an unmoved pool returns the same one and React bails out. `forgeAt`
      // is an anchor rather than a countdown, so this settles the moment a bullet starts and the
      // overlay is left to the browser's own clock for the whole second it takes.
      setAmmo((shown) => {
        const next = {
          bullets: world.ammo(),
          queued: world.queuedBullets(),
          forgeAt: world.forgeStartedAt(),
        };
        return next.bullets === shown.bullets &&
          next.queued === shown.queued &&
          next.forgeAt === shown.forgeAt
          ? shown
          : next;
      });
      // A downed player stops streaming position — peers hold its last pos as a corpse.
      if (!world.isDead()) {
        const pos = world.selfPos();
        if (pos) onPosRef.current(pos);
      }
    }, POS_SEND_MS);
    return () => clearInterval(timer);
  }, []);

  // A button released outside the canvas (or with the tab hidden) must still stop its hold, or that
  // hold would continue with a stale cursor. The two buttons are independent — a demolish and
  // whatever left-click is doing read the pointer without contending — so a release drops only the
  // button that came up. A blur has no button and no way to learn one, so it drops both.
  useEffect(() => {
    const release = (e: MouseEvent) => {
      if (e.button === 2) demolishingRef.current = false;
      if (e.button === 0) {
        leftHeldRef.current = false;
        dragRef.current = null; // the path still queued behind the cursor goes with the button
      }
    };
    const releaseAll = () => {
      demolishingRef.current = false;
      leftHeldRef.current = false;
      dragRef.current = null;
    };
    window.addEventListener("mouseup", release);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("mouseup", release);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);

  const trackPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const drag = dragRef.current;
    if (!drag) return;
    // Every tile between this sample and the last, never only the one under the cursor: a pointer
    // outruns both the frame and the build cadence, and the tiles it crossed on the way are most
    // of what a drag was asked for. A sample that has not left its tile adds nothing, which is what
    // keeps the tile the press already laid from being laid a second time.
    const tile = cursorTile(pointerRef.current, aimRef.current.camera);
    for (const crossed of tilesBetween(drag.at, tile)) drag.pending.push(crossed);
    drag.at = tile;
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    trackPointer(e);
    if (e.button === 0) {
      const kind = selectedRef.current;
      // Left-click is one button with three jobs: lay a run of the selected buildable, or — with
      // the bar empty — shoot with the gun up and mine with it stowed (#120). The buildable is the
      // one of the three latched at the press, because a run must not change what it is laying
      // halfway down its own path; the other two are decided tick by tick, which is what lets `g`
      // swap them under a button that never came up.
      if (kind) {
        const tile = cursorTile(pointerRef.current, aimRef.current.camera);
        dragRef.current = {
          kind,
          at: tile,
          pending: [tile],
          next: 0,
          lastAt: Number.NEGATIVE_INFINITY,
        };
        placeIfDue(Date.now());
      } else {
        leftHeldRef.current = true;
        // A shot leaves in the same breath as the press — waiting for the next frame would put a
        // click's worth of lag on a single tap. A mine has nothing to send yet: the next frame
        // starts its progress, and the press is worth exactly the frame it happened on.
        if (equippedRef.current) fireIfDue(Date.now());
      }
    } else if (e.button === 2) {
      // Right-click is one button with two jobs: cancel the selected buildable, or demolish when
      // nothing is selected (#120 took mining off it). Cancelling deliberately falls through to
      // neither — arming the hold here would start pulling down whatever the cancelled ghost was
      // standing on.
      if (selectedRef.current) {
        selectedRef.current = null; // the ghost must go this frame, not on the next render
        setSelected(null);
      } else {
        demolishingRef.current = true; // right-click demolishes for as long as it is held
      }
    }
  };

  return (
    <main className="game">
      <header className="game-header">
        {/* The lobby code header is gone (ADR 0001) — it is on the lobby screen, where it is
            needed to share, and repeating it mid-match was scaffolding nobody asked for. */}
        <div className="signals" role="status" aria-live="polite">
          {state.status === "reconnecting" && (
            <span className="signal" role="img" aria-label="Reconnecting">
              <SpriteIcon subject={reconnectingIcon} px={24} />
            </span>
          )}
          {underAttack && (
            <span className="signal" role="img" aria-label="A structure is under attack">
              <SpriteIcon subject={warningIcon} px={24} />
            </span>
          )}
        </div>
      </header>
      {/* Focusable only in code: closing the menu hands focus back here, and it is never a stop on
          the way through the HUD with Tab. */}
      <canvas
        ref={canvasRef}
        className="arena"
        aria-label="Game arena"
        tabIndex={-1}
        onMouseMove={trackPointer}
        onMouseDown={onMouseDown}
        onMouseLeave={endDrag}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Escape's menu (#100). Leave is the whole of it — ADR 0001 grants nothing else a place
          here — and it acts on the click, with nothing to confirm. */}
      {menuOpen && (
        <dialog ref={menuRef} className="sheet game-menu" aria-label="Menu">
          <button ref={leaveRef} type="button" onClick={onLeave}>
            Leave
          </button>
        </dialog>
      )}
      {/* The bar stays and its written HP reading goes: #76 signals health with an ink bar, and
          ADR 0001 removed the label beside it. Above it rides the gun (#120) — filled with the
          weapon up, hollow with it down, which is the whole of what the HUD says about it. The
          Health name sits on the bar rather than on this column, because the column now holds two
          things and only one of them is health. */}
      <div className="hud">
        <span className="gun" role="img" aria-label={equipped ? "Gun equipped" : "Gun stowed"}>
          {gunIcon && <SpriteIcon subject={gunIcon} px={GUN_ICON_PX} facing={equipped ? 1 : 0} />}
        </span>
        <div className="hp-bar" role="status" aria-label="Health">
          <div
            className="hp-fill"
            style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
            data-low={hp <= 30}
          />
        </div>
      </div>
      {/* Metal, Energy and the rate's `metal / s` are the words the allowlist grants these readouts. */}
      <div className="banks" role="status" aria-label="Resources">
        {/* A button only so keyboard focus can reach the Metal-per-second reveal — the reveal itself
            is CSS, and the linter rejects `tabIndex` on a non-interactive element (#105). The span
            around the rate box is the aperture it is drawn out of: the box is wider than the readout,
            and this is what clips that overhang while the box is still level with it. */}
        <button type="button" className="bank bank-metal">
          <span className="bank-label">Metal</span>
          <strong>{metal}</strong>
          <span className="bank-reveal">
            <span className="bank-rate">
              <span className="bank-label">metal / s</span>
              <strong>{metalRate}</strong>
            </span>
          </span>
        </button>
        {/* The ammo box stacks on the Energy readout (#102): one square that states the squad's
            bullets, orders another, counts what is still forging in the circle on its corner, and
            veils itself while that bullet is being made. */}
        <div className="bank-stack">
          <button
            type="button"
            className="ammo"
            aria-label="Forge a bullet"
            onClick={onForge}
            // Enter activates a button on *keydown*, so the OS's key repeat fires a click per
            // repeat — a held Enter ordered eight bullets in one press in a real browser. That is
            // the hold-to-repeat `game/forge` has no cadence and no `seq` to survive (#102), so it
            // is refused here. The first press has `repeat` false and still orders; Space is
            // unaffected either way, since it activates on keyup and keyup does not repeat.
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault();
            }}
          >
            {ammoIcon && <SpriteIcon subject={ammoIcon} px={AMMO_ICON_PX} />}
            <strong>{ammo.bullets}</strong>
            {/* Keyed on the anchor so a new bullet restarts the animation, and only then: React
                keeps the element across every other mirror tick, which is what leaves the browser
                running one uninterrupted second rather than the HUD stepping it twenty times. The
                length is inlined from `FORGE_MS` so the bar cannot drift from the forge it draws. */}
            {ammo.forgeAt !== null && (
              <span
                key={ammo.forgeAt}
                className="ammo-forge"
                style={{ animationDuration: `${FORGE_MS}ms` }}
              />
            )}
            {/* After the veil, so the circle stays legible through it without a stacking context. */}
            {ammo.queued > 0 && <span className="ammo-queued">{ammo.queued}</span>}
          </button>
          <span className="bank">
            <span className="bank-label">Energy</span>
            <strong>
              {power.consumption}/{power.generation}
            </strong>
          </span>
        </div>
      </div>
      {/* A slot is its buildable's sprite, its Metal cost in a circle on the top-left corner, and
          its one-word name underneath (#98). The words and the numerals are an ADR 0001 exception,
          asked for explicitly and recorded in the allowlist — the number keys stay gone. */}
      <div className="build-bar" role="toolbar" aria-label="Buildables">
        {BUILD_SLOTS.map((kind, slot) => {
          const icon = SPRITES[kind];
          const spec = BUILDABLES[kind];
          return (
            <button
              key={kind}
              type="button"
              className="build-slot"
              aria-label={kind}
              aria-pressed={selected === kind}
              // A kind with no registry entry has not shipped: the slot shows, but is not usable.
              disabled={!spec}
              onClick={() => setSelected(selected === kind ? null : kind)}
            >
              {/* No spec, no circle: a kind that has not shipped has no cost to state, and an empty
                  circle would read as "free". */}
              {spec && <span className="build-cost">{costs[slot]}</span>}
              {icon && <SpriteIcon subject={icon} px={BUILD_ICON_PX} />}
              <span className="build-name">{BUILD_NAMES[kind]}</span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

function sizeBackingStore(
  canvas: HTMLCanvasElement,
  viewRef: { current: { w: number; h: number; dpr: number } },
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  viewRef.current = { w, h, dpr };
  applyBackingStore(canvas, w, h, dpr);
}

function resizeForDpr(
  canvas: HTMLCanvasElement,
  viewRef: { current: { w: number; h: number; dpr: number } },
  dpr: number,
): void {
  const { w, h } = viewRef.current;
  viewRef.current = { w, h, dpr };
  applyBackingStore(canvas, w, h, dpr);
}

function applyBackingStore(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
}

// What this player is harvesting this instant, or null if it is harvesting nothing — both buttons
// up, a world not up yet, a corpse, or a cursor over bare ground. `resolveHarvest` is what decides
// which of the two it is, so a tile with a structure on it is a demolish and never a mine: a miner
// sits on metal ore by definition, and left-click must not dig out from under one just because the
// button that pulls it down is the other one.
//
// The harvest, the mining pin and the requests all read this one answer, so none of them can outlast
// another. Buttons are read live rather than latched at the press, and that is the whole of #120's
// mid-hold switch: `g` under a held left button changes what the very next frame works on, with
// nothing to re-arm. The build bar is judged here for the same reason and mirrors `fireIfDue` — it
// outranks the gun in both its states, so the bar taken *under* a held button ends a mine the way
// it already ends a shot.
function liveHarvest(
  world: ClientWorld | undefined,
  mining: boolean,
  demolishing: boolean,
  selected: BuildableKind | null,
  pointer: Vec2,
  camera: Camera,
): HarvestTarget {
  if (!world || world.isDead()) return null;
  const target = resolveHarvest(cursorTile(pointer, camera), world.ore, world.build);
  if (target === null) return null;
  if (target.kind === "demolish") return demolishing ? target : null;
  if (!mining || selected) return null;
  // `admitMine` refuses a report from further off than INTERACT_REACH (build.ts:209). Nothing here
  // reads that as the player's true reach — it is an anti-teleport bound — but a mine it provably
  // refuses is not a live mine, and pinning on one would hold the player still banking nothing.
  const self = world.selfPos();
  return self && !withinReach(tileCenter(target.tile), self, INTERACT_REACH) ? null : target;
}

// The tile under the pointer. The camera maps CSS pixels to world units 1:1, so the pointer's
// world position is simply pointer + camera.
function cursorTile(pointer: Vec2, camera: Camera): Tile {
  return tileOf({ x: pointer.x + camera.x, y: pointer.y + camera.y });
}

function selfPos(players: { id: string; pos: Vec2 }[], selfId: string | undefined): Vec2 | null {
  return players.find((p) => p.id === selfId)?.pos ?? null;
}

function center(arena: Arena): Vec2 {
  return { x: arena.width / 2, y: arena.height / 2 };
}
