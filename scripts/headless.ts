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

export function buildPage(bundle: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>sprite review sheet</title>
<style>html,body{margin:0;background:#d8d8d8}canvas{display:block}</style>
<canvas id="sheet"></canvas>
<pre id="measurements" hidden></pre>
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
    return run.stdout.toString();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Read back whatever the page wrote into its measurement sink.
export function measurementsIn(dom: string): unknown | null {
  const found = dom.match(/<pre id="measurements"[^>]*>([\s\S]*?)<\/pre>/);
  if (!found) return null;
  const json = found[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
  return json.trim() ? JSON.parse(json) : null;
}
