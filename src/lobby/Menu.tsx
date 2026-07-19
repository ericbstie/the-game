import { useState } from "react";
import type { LobbyState } from "./client";
import { NAME_MAX } from "./protocol";

interface MenuProps {
  state: LobbyState;
  onHost: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

// Main menu: a shared name field, a Host action, and a Join-by-code form. Errors
// (lobby not found / full / released) surface here as an alert.
export function Menu({ state, onHost, onJoin }: MenuProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const busy = state.status === "connecting";

  return (
    <main className="menu">
      <h1>Breakout Box</h1>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <label className="field">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="Optional"
        />
      </label>
      <div className="actions">
        <button type="button" className="host" onClick={() => onHost(name)} disabled={busy}>
          Host a lobby
        </button>
      </div>
      <form
        className="join"
        onSubmit={(e) => {
          e.preventDefault();
          onJoin(code, name);
        }}
      >
        <label className="field">
          Lobby code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={4}
            autoCapitalize="characters"
            placeholder="e.g. AB3K"
          />
        </label>
        <button type="submit" disabled={busy || code.trim() === ""}>
          Join
        </button>
      </form>
    </main>
  );
}
