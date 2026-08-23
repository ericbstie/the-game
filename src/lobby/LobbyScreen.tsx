import { useEffect, useState } from "react";
import { MAX_ARENA_SIDE } from "../game/build";
import { MIN_ARENA_SIDE } from "../game/enemies";
import { canBake, spriteCache, WARM_BUDGET_MS, warmScale } from "../game/spriteCache";
import {
  knobValue,
  parseWorldSettings,
  type WorldKnob,
  type WorldSettings,
  withKnob,
  worldKnobs,
} from "../game/worldSettings";
import { ZOOM_DEFAULT } from "../game/zoom";
import type { LobbyState } from "./client";
import type { PublicPlayer } from "./protocol";

interface LobbyScreenProps {
  state: LobbyState;
  onLeave: () => void;
  onStart: () => void;
  onSettings: (settings: WorldSettings) => void;
}

// #162. Bake the registry while the squad is still gathering, which is the one stretch of the app
// with time to spend and nothing being drawn. A match opened after a moment here pays no first
// bake; the cost it removes is 3.8 s of bakes at `ZOOM_DEFAULT`, of which 3.7 s is the two tiled
// ore sprites, so the order the cache warms in — everything else first — is what makes a short
// lobby worth anything at all.
//
// One turn per macrotask rather than one long block: the lobby stays responsive, and a squad that
// starts immediately simply gets however much was ready. Nothing here is drawn from and nothing
// waits on it, so stopping half way is a smaller cache and not a broken frame.
function useWarmSprites(): void {
  useEffect(() => {
    if (!canBake()) return;
    const scale = warmScale(window.devicePixelRatio || 1, ZOOM_DEFAULT);
    let stopped = false;
    let timer = 0;
    const turn = () => {
      if (stopped) return;
      if (spriteCache.warm(scale, WARM_BUDGET_MS) > 0) timer = window.setTimeout(turn, 0);
    };
    timer = window.setTimeout(turn, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
}

// The lobby screen: shareable code, the Squad roster, and the world the next match is built from.
// Every seat 1..maxPlayers is shown; occupied seats mark the host and you, and grey out during a
// disconnect grace. Only the host sees Start — it drops the whole Squad into the match.
export function LobbyScreen({ state, onLeave, onStart, onSettings }: LobbyScreenProps) {
  useWarmSprites();
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const seats = Array.from({ length: snapshot.maxPlayers }, (_, i) => i + 1);
  const bySlot = new Map(snapshot.players.map((p) => [p.slot, p]));
  const isHost = snapshot.host === state.self?.id;

  return (
    <main className="lobby sheet">
      <header className="lobby-header">
        <h1>Squad</h1>
        {/* The join code is the one thing on this screen the allowlist names outright — it cannot
            be shared without being read, so it is set as the headline number it is. */}
        <p className="code">
          <span className="code-label">Share code</span>
          <strong>{state.code}</strong>
        </p>
      </header>
      {state.status === "reconnecting" && (
        <p className="banner" role="status">
          Reconnecting…
        </p>
      )}
      <ul className="roster">
        {seats.map((slot) => {
          const player = bySlot.get(slot);
          return (
            <li key={slot} className={seatClass(player)}>
              <span className="slot">{slot}</span>
              {player ? (
                <Seat
                  player={player}
                  isYou={player.id === state.self?.id}
                  isHost={player.id === snapshot.host}
                />
              ) : (
                <span className="empty">Empty</span>
              )}
            </li>
          );
        })}
      </ul>
      <World settings={snapshot.settings} isHost={isHost} onSettings={onSettings} />
      <div className="lobby-actions">
        {isHost && (
          <button type="button" className="start" onClick={onStart}>
            Start game
          </button>
        )}
        <button type="button" onClick={onLeave}>
          Leave
        </button>
      </div>
    </main>
  );
}

// One field per knob, in the order `WorldSettings` declares them (#129). The names the world is
// discussed in, not the field names: `oreEdgeBias` and `nestEdgeBias` are labelled as the two
// separate distributions ADR 0005 decided they are, and each escalation curve's three numbers say
// which curve they belong to.
//
// A knob with no entry here would render nameless, so the pairing is asserted rather than trusted:
// `LobbyScreen.test.tsx` requires every knob `worldKnobs()` lists to carry a label.
const LABELS: Record<string, string> = {
  "arena.width": "Arena width",
  "arena.height": "Arena height",
  metalPatches: "Metal patches",
  powerPatches: "Power patches",
  oreEdgeBias: "Ore distribution",
  nestCount: "Nests",
  nestEdgeBias: "Nest distribution",
  enemyCap: "Enemy cap",
  "nestPeriod.startMs": "Nest period, start (ms)",
  "nestPeriod.fallMs": "Nest period, fall per minute (ms)",
  "nestPeriod.floorMs": "Nest period, floor (ms)",
  "waveSize.start": "Wave size, start",
  "waveSize.growth": "Wave size, growth per minute",
  "waveSize.max": "Wave size, cap",
  "eliteShare.ptsPerMin": "Elite share, points per minute",
  "eliteShare.max": "Elite share, cap",
};

// The knobs as this form offers them: `worldKnobs()`'s own bounds, plus the two limits the settings
// parser deliberately does not carry, both of them the arena's. Past `MAX_ARENA_SIDE` the packed tile
// key collides; below `MIN_ARENA_SIDE` the nest band inverts and nests are placed outside the walls,
// where the squad cannot reach them (#153). Each is degenerate identically on both sides, so neither
// desyncs anyone — they are simply not worlds worth offering (ADR 0006).
//
// Both bounds go on each side rather than on the box: the nest band is read off the shorter side, so
// a floor on the width alone would still admit a 20,000 × 5,000 world.
const OFFERED: WorldKnob[] = worldKnobs().map((knob) =>
  knob.path.startsWith("arena.") ? { ...knob, min: MIN_ARENA_SIDE, max: MAX_ARENA_SIDE } : knob,
);

// A dotted knob is one number of several describing one thing, and the group is what a reader needs
// to know: three of these fields are one escalation curve, and hearing them as three unrelated
// numbers is what a flat list gives a screen reader. `eliteShare` gets one for two fields as much as
// `nestPeriod` does for three — two numbers are still a curve, and a group that appears only when a
// thing has three parts is a rule nobody can hear.
const GROUPS: Record<string, string> = {
  arena: "Arena",
  nestPeriod: "Nest period",
  waveSize: "Wave size",
  eliteShare: "Elite share",
};

const groupOf = (path: string) => (path.includes(".") ? path.split(".")[0] : null);

// What the parser would refuse, said in the form's own terms. `aria-invalid` alone announces "invalid
// entry" and leaves the reason to be guessed; the bounds are already on the knob, so saying them costs
// nothing and is the difference between a mark and a message. Read off the knob rather than restated,
// so a retune of `MAX_MULTIPLE` or `MAX_ARENA_SIDE` cannot leave this lying.
function refusalOf(knob: WorldKnob): string {
  const floor = knob.min === undefined ? "more than 0" : `${knob.min} or more`;
  return knob.max === undefined
    ? `Must be ${floor}.`
    : `Must be ${floor}, and at most ${knob.max}.`;
}

// The world the next match is built from. The host picks and the squad reads — the same fields either
// way, because a squad that cannot see the world it is about to be dropped into is guessing.
//
// Every field's value comes off the session's settings unless the host has typed into that one. That
// is what lets the echo keep the other fifteen current while a host edits one, and what a player
// promoted to host mid-lobby needs: their draft of the rest of the world is nothing at all.
function World({
  settings,
  isHost,
  onSettings,
}: {
  settings: WorldSettings;
  isHost: boolean;
  onSettings: (settings: WorldSettings) => void;
}) {
  const [typed, setTyped] = useState<Record<string, string>>({});

  const field = (knob: WorldKnob) => {
    const raw = typed[knob.path] ?? String(knobValue(settings, knob.path));
    const wrong = raw.trim() !== "" && admit(knob, settings, raw) === null;
    const saying = `${knob.path}-refused`;
    return (
      <label className="field" key={knob.path}>
        {LABELS[knob.path]}
        <input
          type="number"
          name={knob.path}
          value={raw}
          readOnly={!isHost}
          min={knob.min}
          max={knob.max}
          // Set from the same predicate that decides whether to send, so a field the lobby is
          // about to ignore always says so. Absent rather than `false` when there is nothing
          // wrong, including mid-edit: a half-typed number is unfinished, not incorrect.
          aria-invalid={wrong || undefined}
          // Pointed at the reason only while there is one, so nothing is announced on a field that
          // is merely unfinished.
          aria-describedby={wrong ? saying : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setTyped((prev) => ({ ...prev, [knob.path]: next }));
            const settled = admit(knob, settings, next);
            if (settled) onSettings(settled);
          }}
        />
        {wrong && (
          <span className="refused" id={saying}>
            {refusalOf(knob)}
          </span>
        )}
      </label>
    );
  };

  return (
    <details className="world">
      <summary>World</summary>
      <div className="knobs">
        {runs(OFFERED).map((run) =>
          run.group === null ? (
            run.knobs.map(field)
          ) : (
            <fieldset className="group" key={run.group}>
              <legend>{GROUPS[run.group]}</legend>
              {run.knobs.map(field)}
            </fieldset>
          ),
        )}
      </div>
    </details>
  );
}

// The knobs in the order `worldKnobs()` gives them, with each stretch of one group fenced together.
// Walking the list rather than filtering per group is what keeps the form's order the settings' own —
// a group's members are already adjacent, so fencing them costs no reordering, and a knob added to the
// middle of a group later lands where the settings put it rather than where this file would.
function runs(knobs: WorldKnob[]): { group: string | null; knobs: WorldKnob[] }[] {
  const out: { group: string | null; knobs: WorldKnob[] }[] = [];
  for (const knob of knobs) {
    const group = groupOf(knob.path);
    const last = out.at(-1);
    if (last && last.group === group) last.knobs.push(knob);
    else out.push({ group, knobs: [knob] });
  }
  return out;
}

// The world this field would choose, or null if it would not choose one.
//
// Both the offered range and `parseWorldSettings`, because the two are not the same set: the arena's
// floor and its ceiling are this form's alone, and every other floor is the parser's — the two
// strictly-positive knobs left print none, since "greater than zero" has no least value a form field
// can print. Gating the send on it is what keeps
// ADR 0006's refusal off the wire: the server never clamps, so a field that could emit an
// inadmissible world would be a field the lobby silently ignores.
function admit(knob: WorldKnob, settings: WorldSettings, raw: string): WorldSettings | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (knob.min !== undefined && value < knob.min) return null;
  if (knob.max !== undefined && value > knob.max) return null;
  return parseWorldSettings(withKnob(settings, knob.path, value));
}

function Seat({
  player,
  isYou,
  isHost,
}: {
  player: PublicPlayer;
  isYou: boolean;
  isHost: boolean;
}) {
  const disconnected = player.presence.status === "disconnected";
  return (
    <span className="seat">
      <span className="name">{player.name}</span>
      {isHost && <span className="badge host-badge">Host</span>}
      {isYou && <span className="badge you-badge">You</span>}
      {disconnected && <span className="presence">reconnecting…</span>}
    </span>
  );
}

function seatClass(player: PublicPlayer | undefined): string {
  if (!player) return "seat-row vacant";
  return player.presence.status === "disconnected" ? "seat-row disconnected" : "seat-row";
}
