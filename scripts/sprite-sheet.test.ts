import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPage, entrySource, parseArgs, resolveHeadlessShell } from "./sprite-sheet";

describe("parseArgs", () => {
  test("puts the sheet next to the sprite module it renders", () => {
    const request = parseArgs(["src/sprite/calibration.ts"]);
    expect(request.subject).toBe(join(process.cwd(), "src/sprite/calibration.ts"));
    expect(request.out).toBe(join(process.cwd(), "src/sprite/sheet.png"));
    expect(request.dpr).toBe(2);
    expect(request.json).toBe(false);
  });

  test("accepts an explicit output, dpr and json flag", () => {
    const request = parseArgs(["a/b.ts", "--out", "c/d.png", "--dpr", "3", "--json"]);
    expect(request.out).toBe(join(process.cwd(), "c/d.png"));
    expect(request.dpr).toBe(3);
    expect(request.json).toBe(true);
  });

  test("refuses to run without a sprite module", () => {
    expect(() => parseArgs([])).toThrow(/sprite module/);
  });

  test("refuses a dpr that could not have come from a real display", () => {
    expect(() => parseArgs(["a.ts", "--dpr", "0"])).toThrow(/dpr/);
    expect(() => parseArgs(["a.ts", "--dpr", "wide"])).toThrow(/dpr/);
  });

  test("refuses an unknown flag rather than silently ignoring it", () => {
    expect(() => parseArgs(["a.ts", "--scale", "2"])).toThrow(/--scale/);
  });
});

describe("resolveHeadlessShell", () => {
  function browsers(dirs: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "pw-browsers-"));
    for (const dir of dirs) {
      mkdirSync(join(root, dir, "chrome-linux"), { recursive: true });
      writeFileSync(join(root, dir, "chrome-linux", binaryOf(dir)), "");
    }
    return root;
  }
  const binaryOf = (dir: string) => (dir.includes("headless_shell") ? "headless_shell" : "chrome");

  test("finds the headless shell whatever version it is pinned at", () => {
    const root = browsers(["chromium_headless_shell-1194"]);
    expect(resolveHeadlessShell(root)).toBe(
      join(root, "chromium_headless_shell-1194/chrome-linux/headless_shell"),
    );
  });

  test("never falls back to the full browser, which silently paints only its top strip", () => {
    expect(() => resolveHeadlessShell(browsers(["chromium-1194", "chromium"]))).toThrow(
      /headless_shell/,
    );
  });

  test("names the directory it searched when it finds nothing", () => {
    const root = browsers([]);
    expect(() => resolveHeadlessShell(root)).toThrow(root);
  });
});

describe("entrySource", () => {
  test("imports the sprite module and the sheet by absolute path, and bakes at the given dpr", () => {
    const source = entrySource("/repo/src/sprite/player/player.ts", 3, "/repo/src/sprite/sheet.ts");
    expect(source).toContain('from "/repo/src/sprite/player/player.ts"');
    expect(source).toContain('from "/repo/src/sprite/sheet.ts"');
    expect(source).toContain("const dpr = 3;");
    expect(source).toContain("bakeSubject(subject, dpr)");
  });
});

describe("buildPage", () => {
  test("carries the canvas the sheet is drawn on and the sink the measurements go to", () => {
    const page = buildPage("console.log(1)");
    expect(page).toContain('id="sheet"');
    expect(page).toContain('id="measurements"');
    expect(page).toContain("console.log(1)");
  });

  test("neutralises a closing script tag hiding in the bundle", () => {
    expect(buildPage('const s = "</script>"')).not.toContain('"</script>"');
  });
});
