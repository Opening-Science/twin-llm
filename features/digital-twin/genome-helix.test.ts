import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenomeHelix } from "./genome-helix";

describe("GenomeHelix", () => {
  test("renders the static fallback when WebGL is guarded off", () => {
    const markup = renderToStaticMarkup(
      createElement(GenomeHelix, { forceFallback: true }),
    );
    expect(markup).toContain("Decorative helix");
    expect(markup).toContain("data-helix-fallback");
  });

  test("mounts without WebGL and does not throw", () => {
    expect(() => renderToStaticMarkup(createElement(GenomeHelix))).not.toThrow();
    const markup = renderToStaticMarkup(createElement(GenomeHelix));
    expect(markup).toContain("Decorative helix");
  });
});
