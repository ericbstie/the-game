import { appendFileSync } from "node:fs";

export type Bump = "major" | "minor" | "patch" | null;

const HEADER = /^(?<type>\w+)(?:\([^)]*\))?(?<breaking>!)?:/;
const BREAKING_FOOTER = /(^|\n)BREAKING[ -]CHANGE:/;

/**
 * Highest-precedence semver bump implied by a set of conventional-commit
 * messages: breaking change → major, feat → minor, fix/perf → patch.
 * Returns null when nothing warrants a release.
 */
export function determineBump(messages: string[]): Bump {
  let bump: Bump = null;
  for (const message of messages) {
    const header = message.split("\n", 1)[0]?.trim() ?? "";
    const match = header.match(HEADER);
    if (match?.groups?.breaking || BREAKING_FOOTER.test(message)) return "major";

    const type = match?.groups?.type;
    if (type === "feat") bump = "minor";
    else if ((type === "fix" || type === "perf") && bump !== "minor") bump = "patch";
  }
  return bump;
}

export function applyBump(version: string, bump: Bump): string {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return version;
  }
}

function git(args: string[]): string | null {
  const { stdout, exitCode } = Bun.spawnSync(["git", ...args]);
  return exitCode === 0 ? new TextDecoder().decode(stdout) : null;
}

function emit(output: Record<string, string | boolean>): void {
  const lines = Object.entries(output).map(([key, value]) => `${key}=${value}`);
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
  for (const line of lines) console.log(line);
}

if (import.meta.main) {
  const lastTag = git(["describe", "--tags", "--abbrev=0", "--match", "v*"])?.trim();
  const current = lastTag ? lastTag.replace(/^v/, "") : "0.0.0";
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const log = git(["log", range, "--format=%B%x00"]) ?? "";
  const messages = log
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);

  const bump = determineBump(messages);
  const next = applyBump(current, bump);

  emit({ current, next, bump: bump ?? "none", released: bump !== null && next !== current });
}
