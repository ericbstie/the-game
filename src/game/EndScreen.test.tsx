import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EndScreen, formatElapsed } from "./EndScreen";

describe("formatElapsed", () => {
  test("renders m:ss.t", () => {
    expect(formatElapsed(0)).toBe("0:00.0");
    expect(formatElapsed(9_400)).toBe("0:09.4");
    expect(formatElapsed(65_000)).toBe("1:05.0");
    expect(formatElapsed(3_723_400)).toBe("62:03.4"); // minutes keep counting past an hour
  });

  test("a negative elapsed (a clock skewed backwards) reads as zero, not as garbage", () => {
    expect(formatElapsed(-500)).toBe("0:00.0");
  });
});

describe("EndScreen", () => {
  test("an escape shows the squad's time", () => {
    render(<EndScreen outcome="escaped" elapsedMs={125_300} onLeave={() => {}} />);
    expect(screen.getByRole("heading", { name: "Escaped" })).toBeDefined();
    expect(screen.getByText("Escape time")).toBeDefined();
    expect(screen.getByText("2:05.3")).toBeDefined();
  });
});

describe("EndScreen outcomes read distinctly", () => {
  test("a wipe is a loss, not a quieter win", () => {
    render(<EndScreen outcome="wiped" elapsedMs={61_000} onLeave={() => {}} />);
    expect(screen.getByRole("heading", { name: "Wiped" })).toBeDefined();
    expect(screen.getByText("Survived for")).toBeDefined();
    expect(screen.getByText("1:01.0")).toBeDefined();
  });

  test("the outcome is on the root, so the two are styleable apart", () => {
    const { container } = render(<EndScreen outcome="wiped" elapsedMs={0} onLeave={() => {}} />);
    expect(container.querySelector('[data-outcome="wiped"]')).not.toBeNull();
  });
});
