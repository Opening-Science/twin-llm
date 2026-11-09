import { describe, expect, test } from "bun:test";

import {
  INLINE_LIGHT,
  localHour,
  lookFor,
  luminance,
  MIDDAY_HOUR,
  mixHex,
  OUTDOOR_KEYFRAMES,
  outdoorsLook,
  studioLook,
} from "./environment-look";
import { BRAND_PALETTE } from "../twin-palette";

const { dark: DARK, light: LIGHT } = BRAND_PALETTE;

const NIGHT_WORLD = {
  skyTop: 0x1c2c4c,
  horizon: 0x3b4f74,
  ground: 0x2a3650,
  grid: 0x4b5e84,
  gridAlpha: 0.5,
  fogNear: 4,
  fogFar: 22,
  dark: true,
};
const NIGHT_LIGHT = {
  hemisphere: 0.35,
  key: 1.6,
  keyColor: 0xc4d0ff,
  rim: 0.3,
  environment: 0.7,
};

describe("environment look", () => {
  test("mixHex blends each sRGB channel and rounds half up", () => {
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixHex(0x4a6fa5, 0x6fa8dc, 0.5)).toBe(0x5d8cc1);
    expect(mixHex(0x123456, 0xabcdef, 0)).toBe(0x123456);
    expect(mixHex(0x123456, 0xabcdef, 1)).toBe(0xabcdef);
  });

  test("luminance is WCAG relative luminance", () => {
    expect(luminance(0xffffff)).toBe(1);
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0x808080)).toBeCloseTo(0.2158605, 6);
  });

  test("localHour reads the device clock with minutes", () => {
    expect(localHour(new Date(2026, 9, 20, 9, 45))).toBe(9.75);
    expect(localHour(new Date(2026, 9, 20, 0, 0))).toBe(0);
    expect(localHour(new Date(2026, 9, 20, 23, 30))).toBe(23.5);
  });

  test("the keyframes span one day and wrap night to night", () => {
    expect(OUTDOOR_KEYFRAMES.map((frame) => frame.hour)).toEqual([
      0, 5, 6.5, 13, 19, 21, 24,
    ]);
    expect(outdoorsLook(0)).toEqual(outdoorsLook(24));
  });

  test("night holds from 21:00 to 05:00", () => {
    for (const hour of [21, 23, 0, 3, 5]) {
      expect(outdoorsLook(hour)).toEqual({ world: NIGHT_WORLD, light: NIGHT_LIGHT });
    }
  });

  test("the world and the body stay readable at every half hour", () => {
    // Floors, not snapshots: the old night (horizon 0.024, ground 0.011, key 1.2)
    // read as an empty view on a dim laptop screen (21 Oct). Any look may be
    // brighter; none may drop below these.
    const hours = Array.from({ length: 48 }, (_, index) => index / 2);
    for (const hour of hours) {
      const { world, light } = outdoorsLook(hour);
      expect(luminance(world.horizon)).toBeGreaterThanOrEqual(0.07);
      expect(luminance(world.ground)).toBeGreaterThanOrEqual(0.035);
      expect(light.key).toBeGreaterThanOrEqual(1.6);
    }
  });

  test("midday is the day keyframe with the inline lights", () => {
    expect(outdoorsLook(13)).toEqual({
      world: {
        skyTop: 0x6fa8dc,
        horizon: 0xdfeaf3,
        ground: 0x9aa5ad,
        grid: 0xb8c2c9,
        gridAlpha: 0.4,
        fogNear: 4,
        fogFar: 22,
        dark: false,
      },
      light: INLINE_LIGHT,
    });
  });

  test("halfway from dawn to midday", () => {
    const look = outdoorsLook(9.75);
    expect(look.world).toEqual({
      skyTop: 0x5d8cc1,
      horizon: 0xe9d8ca,
      ground: 0x83888f,
      grid: 0xa1a5ad,
      gridAlpha: 0.4,
      fogNear: 4,
      fogFar: 22,
      dark: false,
    });
    expect(look.light.key).toBeCloseTo(1.8, 10);
    expect(look.light.keyColor).toBe(0xffecdc);
    expect(look.light.environment).toBeCloseTo(0.9, 10);
  });

  test("dusk and dawn floors take the dark pool tint", () => {
    expect(outdoorsLook(6.5).world.dark).toBe(true);
    expect(outdoorsLook(19).world.dark).toBe(true);
  });

  test("the studio is drawn in the theme's brand tokens and ignores the clock", () => {
    expect(lookFor("studio", DARK, 3)).toEqual(lookFor("studio", DARK, 15));
    expect(lookFor("studio", DARK, null).world).toEqual({
      skyTop: 0x242424,
      horizon: 0x1d1d1d,
      ground: 0x1d1d1d,
      grid: 0x1d1d1d,
      gridAlpha: 0,
      fogNear: 4,
      fogFar: 22,
      dark: true,
    });
    expect(lookFor("studio", LIGHT, null).world.skyTop).toBe(0xffffff);
    expect(lookFor("studio", LIGHT, null).world.ground).toBe(0xf8f8f4);
    expect(lookFor("studio", LIGHT, null).world.dark).toBe(false);
    expect(lookFor("studio", LIGHT, null).light).toEqual(INLINE_LIGHT);
  });

  test("the studio takes whatever the tokens resolve to", () => {
    const custom = { ...LIGHT, background: "#102030", card: "#405060" };
    expect(studioLook(custom).world.skyTop).toBe(0x405060);
    expect(studioLook(custom).world.ground).toBe(0x102030);
    expect(studioLook(custom).world.dark).toBe(true);
  });

  test("outdoors without the clock is fixed at midday, whatever the theme", () => {
    expect(MIDDAY_HOUR).toBe(13);
    expect(lookFor("outdoors", DARK, null)).toEqual(outdoorsLook(13));
    expect(lookFor("outdoors", LIGHT, 3)).toEqual(outdoorsLook(3));
  });

  test("inline lights are the viewer's original values", () => {
    expect(INLINE_LIGHT).toEqual({
      hemisphere: 0.3,
      key: 2,
      keyColor: 0xffffff,
      rim: 0.35,
      environment: 1,
    });
  });
});
