import { describe, expect, test } from "bun:test";

// The stylesheet is read as text rather than through a DOM, because the claim is about which
// *selector* carries a declaration and no test DOM here has a cascade to ask. happy-dom applies no
// author stylesheet at all — nothing in `bun test` ever loads this file — so a rule moved from
// `.arena` onto `body` would go on passing every other test in the repo.
const SHEET = await Bun.file(`${import.meta.dir}/styles.css`).text();

// One rule's declarations, by selector. Deliberately naive: this sheet has no nesting and no
// at-rule with a body of its own, so a block is a selector, a brace, and everything up to the next
// closing brace.
function rule(selector: string): string | null {
  const at = SHEET.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = SHEET.indexOf("{", at);
  return SHEET.slice(open + 1, SHEET.indexOf("}", open));
}

// Every selector in the sheet that declares a cursor of its own, whatever it sets it to.
function cursorRules(): string[] {
  const found: string[] = [];
  for (const match of SHEET.matchAll(/(^|\n)([^{}]+?)\s*\{([^}]*)\}/g)) {
    if (/(^|;|\s)cursor\s*:/.test(match[3])) found.push(match[2].trim());
  }
  return found;
}

// #154: the aim point gets a mark of its own, drawn on the canvas — so the OS arrow that used to be
// that mark is hidden, and the two are never up at once.
describe("#154: the OS cursor is hidden over the arena and nowhere else", () => {
  test("the arena hides it", () => {
    expect(rule(".arena")).toContain("cursor: none");
  });

  // The mark that replaces it is painted by `drawWorld`, which paints the canvas and nothing else.
  // Everything beside the arena — the HUD's buttons, Escape's menu, the lobby and the end screen —
  // has no mark of its own, so hiding the pointer there would leave those surfaces unusable.
  test("nothing else in the sheet hides it", () => {
    for (const selector of cursorRules()) {
      if (selector === ".arena") continue;
      expect(rule(selector)).not.toContain("cursor: none");
    }
  });

  test("the buttons keep the cursors they already had", () => {
    expect(cursorRules().length).toBeGreaterThan(1);
  });
});
