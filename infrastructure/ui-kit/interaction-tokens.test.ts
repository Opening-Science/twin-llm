import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrast, readToken } from "./oklch-contrast";

/**
 * The interaction patterns (step trace, undo, hold to confirm, status
 * lattice, rating) draw state with marks, not words alone: a tick, a cross,
 * a burning line, a fill edge. WCAG 1.4.11 asks 3:1 for such marks against
 * what they sit on. These read the real globals.css in both themes, and
 * check the section itself uses tokens, never a colour of its own.
 */

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");

const section = (() => {
  const start = css.indexOf("--- Interaction patterns");
  const end = css.indexOf("@media (prefers-reduced-motion: reduce)", start);
  return css.slice(start, end);
})();

const MARKS = ["winner", "destructive", "foreground", "muted-foreground"] as const;

describe.each([":root", ".dark"])("interaction marks in %s", (scope) => {
  test.each(MARKS)("--%s clears 3:1 on the card and the page", (name) => {
    const mark = readToken(css, scope, name);
    expect(contrast(mark, readToken(css, scope, "card"))).toBeGreaterThanOrEqual(3);
    expect(contrast(mark, readToken(css, scope, "background"))).toBeGreaterThanOrEqual(3);
  });
});

describe("the interaction section", () => {
  test("exists and covers every pattern", () => {
    for (const block of [
      ".step-trace",
      ".undo-button-line",
      ".hold-confirm-fill",
      ".status-lattice-dot",
      ".rating-item",
    ]) {
      expect(section).toContain(block);
    }
  });

  test("uses tokens only: no hex, rgb, hsl or oklch literals", () => {
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  test("every animation it starts is stopped under reduced motion", () => {
    const reduced = css.slice(
      css.indexOf(
        "@media (prefers-reduced-motion: reduce)",
        css.indexOf("--- Interaction patterns"),
      ),
    );
    for (const selector of [
      ".step-trace-working",
      ".step-trace-waiting",
      ".step-trace-dot[data-pulse]",
      '.status-lattice[data-state="working"] .status-lattice-dot',
    ]) {
      expect(reduced.slice(0, 600)).toContain(selector);
    }
  });
});
