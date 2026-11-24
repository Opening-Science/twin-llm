import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GLUCOSE_NOT_INSTALLED,
  GlucoseControl,
  type GlucoseControlModel,
} from "./glucose-control";

const render = (overrides: Partial<GlucoseControlModel> = {}) =>
  renderToStaticMarkup(
    createElement(GlucoseControl, {
      control: {
        density: 0.5,
        status: "ready",
        unavailable: null,
        onDensity: () => undefined,
        onRetry: () => undefined,
        ...overrides,
      },
    }),
  );

describe("glucose density slider", () => {
  test("is labelled, bounded and describes the exact count and illustrative scope", () => {
    const html = render();
    expect(html).toContain("Vessel particles</label>");
    expect(html).toContain('type="range" min="0" max="1" step="0.01"');
    expect(html).toContain('aria-valuetext="90 of 180 particles"');
    expect(html).toContain(
      "Illustrative particles, not measured glucose particles or blood velocity.",
    );
    expect(html).toContain("Organs depth with Cardiovascular enabled.");
    expect(html).not.toContain('disabled=""');
    expect(render({ density: 0 })).toContain('aria-valuetext="0 of 180 particles"');
    expect(render({ density: 1 })).toContain('aria-valuetext="180 of 180 particles"');
  });

  test("unsupported states disable the slider and explain the limitation", () => {
    const html = render({
      unavailable: "Particles are not available with a fitted atlas.",
    });
    expect(html).toContain('disabled=""');
    expect(html).toContain("Particles are not available with a fitted atlas.");
  });

  test("loading and failures are explicit, with retry on failure", () => {
    expect(render({ status: "loading" })).toContain("Loading particles...");
    const html = render({ status: "error" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load the particles.");
    expect(html).toContain("Try again</button>");
  });

  test("a file not fetched here is a plain state, not an error", () => {
    const html = render({ status: "missing" });
    expect(html).toContain(GLUCOSE_NOT_INSTALLED);
    expect(html).not.toContain("bun run");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Try again");
    expect(html).toContain('disabled=""');
  });
});
