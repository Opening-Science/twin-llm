import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The floating sidebar button (shell-frame.tsx) sits over the page. On a
 * phone a scrolled line used to slide under it; a sticky band at the top of
 * the scrolling page, as tall as the button's corner, now covers that strip.
 */

const css = readFileSync(join(import.meta.dir, "../../app/globals.css"), "utf8");

/** The `@apply` line of the first rule whose selector is exactly `selector`. */
const applyOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return /@apply ([^;]+);/.exec(body)?.[1] ?? "";
};

const classes = (selector: string): readonly string[] => applyOf(selector).split(/\s+/);

/** Tailwind's spacing step is 0.25rem, 4px at the default root size. */
const px = (step: string): number => Number(step) * 4;

describe("the top band under the sidebar button", () => {
  const band = classes(".shell-main:not(:has(.thread-bar))::before");
  const toggle = classes(".shell-toggle");

  test("stays at the top while the page scrolls, with a background", () => {
    expect(band).toContain("sticky");
    expect(band).toContain("top-0");
    expect(band.some((c) => c.startsWith("bg-background"))).toBe(true);
  });

  test("is as tall as the button's top offset plus its size", () => {
    const height = px(band.find((c) => c.startsWith("h-"))!.slice(2));
    const top = px(toggle.find((c) => c.startsWith("top-"))!.slice(4));
    const size = px(toggle.find((c) => c.startsWith("size-"))!.slice(5));
    expect(height).toBe(top + size);
  });

  test("lies under the button, so the button stays on top", () => {
    const z = (list: readonly string[]) =>
      Number(list.find((c) => c.startsWith("z-"))!.slice(2));
    expect(z(band)).toBeLessThan(z(toggle));
  });

  test("is for narrow screens; from lg a top padding clears the button as before", () => {
    expect(band).toContain("lg:hidden");
    expect(applyOf(".shell-main:not(:has(.thread-bar))")).toBe("lg:pt-10");
    expect(applyOf('[data-sidebar="pinned"] .shell-main:not(:has(.thread-bar))')).toBe(
      "lg:pt-0",
    );
  });
});
