import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

test("renders a blank canvas", () => {
  const { container } = render(<App />);
  const canvas = container.querySelector("canvas");

  expect(canvas).not.toBeNull();
  expect(canvas?.tagName).toBe("CANVAS");
});
