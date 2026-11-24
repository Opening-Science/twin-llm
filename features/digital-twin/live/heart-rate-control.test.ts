import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { heartAnimationRate, HeartRateControl } from "./heart-rate-control";

describe("heart animation rate", () => {
  test("defaults to the recorded rate or an explicitly illustrative 70 bpm", () => {
    expect(heartAnimationRate(61, null, false)).toEqual({ bpm: 61, illustrative: false });
    expect(heartAnimationRate(null, null, false)).toEqual({
      bpm: 70,
      illustrative: true,
    });
    expect(heartAnimationRate(61, 110, false)).toEqual({ bpm: 110, illustrative: true });
    expect(heartAnimationRate(null, 110, false)).toEqual({
      bpm: 110,
      illustrative: true,
    });
  });

  test("night playback takes priority, including gaps, and closing it restores the override", () => {
    expect(heartAnimationRate(55, 110, true)).toEqual({ bpm: 55, illustrative: false });
    expect(heartAnimationRate(null, 110, true)).toEqual({
      bpm: null,
      illustrative: false,
    });
    expect(heartAnimationRate(61, 110, false)).toEqual({ bpm: 110, illustrative: true });
  });

  test("shows 25–230 bpm controls, reset, and disabled playback explanation", () => {
    const control = {
      bpm: 110,
      overridden: true,
      nightPlayback: false,
      onChange: () => undefined,
      onReset: () => undefined,
    };
    const html = renderToStaticMarkup(createElement(HeartRateControl, { control }));
    expect(html).toContain('min="25"');
    expect(html).toContain('max="230"');
    expect(html).toContain('step="1"');
    expect(html).toContain("110 bpm");
    expect(html).toContain("recorded readings are unchanged");
    expect(html).toContain("Use recorded or default rate");
    const night = renderToStaticMarkup(
      createElement(HeartRateControl, {
        control: { ...control, bpm: null, nightPlayback: true },
      }),
    );
    expect(night).toContain("No reading");
    expect(night).toContain('disabled=""');
    expect(night).toContain("Night playback controls the animation rate");
    expect(night).not.toContain("Use recorded or default rate");
  });
});
