import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusBadge, type StatusTone } from "./status-badge";

const tones: readonly StatusTone[] = ["neutral", "ok", "warn", "off"];

describe("StatusBadge", () => {
  test.each([...tones])("%s always says its state in words", (tone) => {
    const html = renderToStaticMarkup(<StatusBadge tone={tone}>Connected</StatusBadge>);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain('aria-hidden="true"></span>Connected</span>');
  });

  test("ok and warn reuse the measured text tokens", () => {
    const ok = renderToStaticMarkup(<StatusBadge tone="ok">Ready</StatusBadge>);
    const warn = renderToStaticMarkup(<StatusBadge tone="warn">Unavailable</StatusBadge>);
    expect(ok).toContain("text-winner");
    expect(warn).toContain("text-destructive");
  });

  test("off draws a hollow dot so it differs from neutral without colour", () => {
    const off = renderToStaticMarkup(<StatusBadge tone="off">Off</StatusBadge>);
    expect(off).toContain('class="size-1.5 rounded-full border-muted-foreground border"');
  });
});
