import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DigitalTwinTabs } from "./digital-twin-tabs";

const tabs = [
  { href: "/digital-twin", label: "Your Twin" },
  { href: "/digital-twin/your-day", label: "Your Day" },
  { href: "/digital-twin/your-10-days", label: "Your 10-Days" },
] as const;

describe("Digital Twin tabs", () => {
  for (const current of tabs) {
    test(`marks just ${current.label} as the current page`, () => {
      const html = renderToStaticMarkup(<DigitalTwinTabs pathname={current.href} />);
      expect(html).toContain('<nav aria-label="Digital Twin"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      for (const { href, label } of tabs) {
        const link = html.match(new RegExp(`<a [^>]*href="${href}"[^>]*>${label}</a>`));
        expect(link).not.toBeNull();
        expect(link?.[0].includes('aria-current="page"')).toBe(href === current.href);
      }
    });
  }
});
