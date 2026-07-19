import { expect, test } from "bun:test";
import { applyBump, determineBump } from "./next-version";

test("feat implies a minor bump", () => {
  expect(determineBump(["feat: add door"])).toBe("minor");
});

test("fix and perf imply a patch bump", () => {
  expect(determineBump(["fix: clamp health"])).toBe("patch");
  expect(determineBump(["perf: cache sprites"])).toBe("patch");
});

test("bang marks a breaking change", () => {
  expect(determineBump(["feat!: new save format"])).toBe("major");
  expect(determineBump(["refactor(core)!: drop legacy loop"])).toBe("major");
});

test("BREAKING CHANGE footer marks a breaking change", () => {
  expect(determineBump(["feat: rework\n\nBREAKING CHANGE: config moved"])).toBe("major");
});

test("chore and docs alone warrant no release", () => {
  expect(determineBump(["chore: deps", "docs: readme"])).toBeNull();
});

test("highest precedence wins across commits", () => {
  expect(determineBump(["fix: a", "feat: b", "docs: c"])).toBe("minor");
  expect(determineBump(["feat: a", "fix!: b"])).toBe("major");
});

test("applyBump follows semver", () => {
  expect(applyBump("1.2.3", "major")).toBe("2.0.0");
  expect(applyBump("1.2.3", "minor")).toBe("1.3.0");
  expect(applyBump("1.2.3", "patch")).toBe("1.2.4");
  expect(applyBump("1.2.3", null)).toBe("1.2.3");
});
