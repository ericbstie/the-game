import { describe, expect, test } from "bun:test";
import { assertPageRan, buildPage, measurementsIn, pageErrorIn } from "./headless";

// Nothing here rasterises: `bun test` has no browser, and CI has none either. What these cover is
// the part of #174 that is decidable without one — that the hook is in the page at all, and that a
// throw and a page that measured nothing stay two different things on the way back out.

const dumped = (measurements: string, error = "") =>
  `<!doctype html><html><body><canvas id="sheet"></canvas>` +
  `<pre id="measurements" hidden>${measurements}</pre>` +
  `<pre id="page-error" hidden>${error}</pre></body></html>`;

describe("buildPage", () => {
  const page = buildPage("const drawn = 1;");

  test("installs the error hook before the bundle, so a module-scope throw is caught", () => {
    expect(page).toContain('<pre id="page-error"');
    expect(page.indexOf("addEventListener")).toBeLessThan(page.indexOf("const drawn = 1;"));
  });

  test("catches both a throw and a rejected promise", () => {
    expect(page).toContain('addEventListener("error"');
    expect(page).toContain('addEventListener("unhandledrejection"');
  });

  test("keeps the first error rather than the last", () => {
    expect(page).toContain("if (!sink.textContent)");
  });
});

describe("pageErrorIn", () => {
  test("carries the throw back with its stack", () => {
    const stack =
      "TypeError: Cannot read properties of undefined (reading 'length')\n    at f (x:1)";
    expect(pageErrorIn(dumped("", stack))).toBe(stack);
  });

  test("decodes what --dump-dom escaped, so a stack is readable", () => {
    expect(pageErrorIn(dumped("", "Error: a &lt;b&gt; &amp; &quot;c&quot;"))).toBe(
      'Error: a <b> & "c"',
    );
  });

  // The distinction #174 exists for: measuring nothing is legal, and throwing is not.
  test("a page that ran and wrote nothing did not throw", () => {
    expect(pageErrorIn(dumped(""))).toBeNull();
    expect(measurementsIn(dumped(""))).toBeNull();
  });

  test("a page that measured something did not throw either", () => {
    expect(pageErrorIn(dumped('{"ink":3}'))).toBeNull();
    expect(measurementsIn(dumped('{"ink":3}'))).toEqual({ ink: 3 });
  });

  test("a sink of pure whitespace is not an error", () => {
    expect(pageErrorIn(dumped("", "\n  \n"))).toBeNull();
  });
});

// The one line that turns a dead page into the caller's error. It lives here rather than inline in
// `capture` because everything either side of it needs a browser, and this does not.
describe("assertPageRan", () => {
  test("raises the throw, naming what was being rendered", () => {
    expect(() =>
      assertPageRan(dumped("", "TypeError: nope\n    at f (x:1)"), "ore-metal seams"),
    ).toThrow(/ore-metal seams threw in the page:\nTypeError: nope\n    at f \(x:1\)/);
  });

  test("says nothing about a page that ran, whether or not it measured anything", () => {
    expect(() => assertPageRan(dumped(""), "a frame")).not.toThrow();
    expect(() => assertPageRan(dumped('{"ink":3}'), "a frame")).not.toThrow();
  });
});
