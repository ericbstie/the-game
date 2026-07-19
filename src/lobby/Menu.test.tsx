import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LobbyState } from "./client";
import { Menu } from "./Menu";

afterEach(cleanup);

const menuState: LobbyState = { status: "menu" };

describe("Menu", () => {
  test("Host passes the typed name to onHost", () => {
    const onHost = mock();
    render(<Menu state={menuState} onHost={onHost} onJoin={mock()} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /host a lobby/i }));
    expect(onHost).toHaveBeenCalledWith("Ana");
  });

  test("Join passes the typed code and name to onJoin", () => {
    const onJoin = mock();
    render(<Menu state={menuState} onHost={mock()} onJoin={onJoin} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ben" } });
    fireEvent.change(screen.getByLabelText(/lobby code/i), { target: { value: "AB3K" } });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    expect(onJoin).toHaveBeenCalledWith("AB3K", "Ben");
  });

  test("an error is surfaced as an alert", () => {
    render(
      <Menu state={{ status: "menu", error: "Lobby not found" }} onHost={mock()} onJoin={mock()} />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/not found/i);
  });
});
