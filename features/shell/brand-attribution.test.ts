import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BrandAttribution,
  FOUNDATION_URL,
  LOGO_NEGATIVE,
  LOGO_POSITIVE,
} from "./brand-attribution";

const html = renderToStaticMarkup(createElement(BrandAttribution));
const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);

describe("BrandAttribution", () => {
  test("links to the foundation's site in a new tab", () => {
    expect(
      html.startsWith(`<a href="${FOUNDATION_URL}" target="_blank" rel="noreferrer"`),
    ).toBe(true);
  });

  test("names the foundation in full in the alt text, never the abbreviation", () => {
    expect(imgs.map((img) => /alt="([^"]*)"/.exec(img)?.[1])).toEqual([
      "Open Science Foundation",
      "Open Science Foundation",
    ]);
    expect(html).not.toContain("OSF");
  });

  test("positive lockup on light, negative on dark", () => {
    expect(imgs[0]).toContain(`src="${LOGO_POSITIVE}"`);
    expect(imgs[0]).toContain('class="dark:hidden"');
    expect(imgs[1]).toContain(`src="${LOGO_NEGATIVE}"`);
    expect(imgs[1]).toContain('class="hidden dark:block"');
  });

  test("keeps the lockup's proportions", () => {
    for (const img of imgs) {
      expect(img).toContain('width="120"');
      expect(img).toContain('height="55"');
    }
    expect(Math.round((120 * 236.98) / 519.74)).toBe(55);
  });
});

/** The brand guide's manifest hashes (assets/logo/manifest.json @0395ce4). */
const PINNED: Record<string, string> = {
  [LOGO_POSITIVE]: "6a2813ca6de4b2c10f99948a1c1124cbc2a0c2a51c457d62cecdb1d5e86d5f8a",
  [LOGO_NEGATIVE]: "a4effe8c61e077fa7881ed6e87412b2de1cc2ca11db8cbf00096727c48db4f2a",
};

test.each(Object.entries(PINNED))(
  "%s is the unmodified brand-guide file",
  (path, sha) => {
    const bytes = readFileSync(join(import.meta.dir, "../../public", path));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  },
);
