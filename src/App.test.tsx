import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

test("opens on the main menu with Host and Join actions", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /host a lobby/i })).not.toBeNull();
  expect(screen.getByRole("button", { name: /join/i })).not.toBeNull();
});
