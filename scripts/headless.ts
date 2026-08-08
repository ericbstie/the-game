import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Running a page in headless Chromium and capturing what it drew. One owner for it, because two
// things need it — the sprite review sheet and a real frame of the game — and the flags are
// exactly where a silent, hard-to-diagnose failure hides.
//
// Nothing here is a new dependency: Chromium and Bun are already installed, and one launch
// produces both channels at once — the screenshot, and a DOM dump carrying measurements taken on
// a real canvas (#77 §1–2). Playwright is deliberately not used: only its browser binaries are
// installed, and the raw binary does this in one flag.

const BROWSERS_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";

// `/opt/pw-browsers/chromium` is the WRONG binary and fails silently: under `--headless` it writes
// a PNG of the requested size but paints only the top ~40 px, because the window size it is given
// includes browser chrome. It looks exactly like a broken sprite. Only `headless_shell` renders a
// full page (#77 §1). Resolved by glob so a browser version bump does not break the harness, and
// never by falling back to anything else.
export function resolveHeadlessShell(root = BROWSERS_ROOT): string {
  const pattern = "chromium_headless_shell-*/chrome-linux/headless_shell";
  const found = existsSync(root)
    ? [...new Bun.Glob(pattern).scanSync({ cwd: root, absolute: true })].sort()
    : [];
  const shell = found.at(-1);
  if (!shell) throw new Error(`no ${pattern} under ${root} — set HEADLESS_SHELL to override`);
  return shell;
}

// A page that throws writes the throw here, and `capture` turns it into the error the caller sees.
// Installed before the bundle so a throw at module scope is caught too, and it keeps the *first*
// error: a page that dies usually goes on to fail in other ways, and the first one is the cause.
//
// `window.onerror` rather than `--enable-logging=stderr` because it is the only one of the two that
// carries a stack (#174). The exit status is no help at all — it is 0 whether the page throws or
// not, measured on this exact launch.
const ERROR_HOOK = `
var sink = document.getElementById("page-error");
var keep = function (what) { if (!sink.textContent) sink.textContent = what; };
addEventListener("error", function (e) { keep(String((e.error && e.error.stack) || e.message)); });
addEventListener("unhandledrejection", function (e) {
  keep(String((e.reason && e.reason.stack) || e.reason));
});
`;

export function buildPage(bundle: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>sprite review sheet</title>
<style>html,body{margin:0;background:#d8d8d8}canvas{display:block}</style>
<canvas id="sheet"></canvas>
<pre id="measurements" hidden></pre>
<pre id="page-error" hidden></pre>
<script>${ERROR_HOOK}</script>
<script>${bundle.replaceAll("</script", "<\\/script")}</script>
`;
}

export interface Capture {
  entry: string; // TypeScript source of the browser entry; it draws into #sheet
  out: string; // where the PNG goes
  width: number; // device pixels. `--screenshot` captures the viewport, so a page taller than
  height: number; // this is cropped without a word — the caller must know the size up front.
  label: string; // what is being rendered, for error messages
}

// Bundle the entry, inline it into a bare page, run it, and write the screenshot. Returns the
// DOM after scripts ran, which is how anything the page measured on a real canvas gets back out.
export async function capture(request: Capture): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "headless-"));
  try {
    const entry = join(work, "entry.ts");
    writeFileSync(entry, request.entry);
    const bundle = await Bun.build({ entrypoints: [entry], target: "browser" });
    if (!bundle.success) throw new AggregateError(bundle.logs, `could not bundle ${request.label}`);
    const page = join(work, "page.html");
    writeFileSync(page, buildPage(await bundle.outputs[0].text()));

    const shell = process.env.HEADLESS_SHELL ?? resolveHeadlessShell();
    const run = Bun.spawnSync([
      shell,
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--screenshot=${request.out}`,
      "--dump-dom", // both channels come out of the same launch
      `--window-size=${request.width},${request.height}`,
      `file://${page}`,
    ]);
    const dom = run.stdout.toString();
    // Before the caller ever looks for measurements. A page that threw wrote none, and an absence
    // is what every caller reports — naming the sink rather than the cause (#166, #174).
    const threw = pageErrorIn(dom);
    if (threw) throw new Error(`${request.label} threw in the page:\n${threw}`);
    return dom;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function sinkText(dom: string, id: string): string {
  const found = dom.match(new RegExp(`<pre id="${id}"[^>]*>([\\s\\S]*?)</pre>`));
  if (!found) return "";
  return found[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

// Read back whatever the page wrote into its measurement sink.
export function measurementsIn(dom: string): unknown | null {
  const json = sinkText(dom, "measurements");
  return json.trim() ? JSON.parse(json) : null;
}

// What the page threw, stack and all, or null if it ran to the end. Distinct from measuring
// nothing: a page is allowed to write no measurements, and that is not this.
export function pageErrorIn(dom: string): string | null {
  const threw = sinkText(dom, "page-error").trim();
  return threw ? threw : null;
}
