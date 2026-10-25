/**
 * What the environment looks like, as plain numbers, so a preset or an hour
 * of the day can be tested without a renderer. Colours are sRGB hex; the
 * shaders convert them to the output colour space, so the hex is what shows.
 *
 * Only colours and intensities change between looks, never the number of
 * lights or the materials' defines, so switching look never recompiles a
 * shader. Fog lives in the sky and ground shaders only: the body, its glass
 * layers and the depth fade render exactly as they do outside the environment.
 *
 * The key light keeps its front-top direction at every hour. A sun that moves
 * behind the body would light it from the back at dusk, and the body has to
 * stay readable; the time of day shows in colour and brightness instead.
 */

export type EnvironmentPreset = "studio" | "outdoors";

export const ENVIRONMENT_PRESETS: readonly EnvironmentPreset[] = ["studio", "outdoors"];

export type LightLook = Readonly<{
  hemisphere: number;
  key: number;
  keyColor: number;
  rim: number;
  /** `scene.environmentIntensity` for the room reflections. */
  environment: number;
}>;

export type WorldLook = Readonly<{
  skyTop: number;
  horizon: number;
  ground: number;
  grid: number;
  /** 0 hides the ground grid (the studio is a seamless floor). */
  gridAlpha: number;
  /** Metres from the body where the ground starts to fade into the horizon, and where it is gone. */
  fogNear: number;
  fogFar: number;
  /** Whether the contact pool should use its dark-floor tint. */
  dark: boolean;
}>;

export type EnvironmentLook = Readonly<{ world: WorldLook; light: LightLook }>;

/** The lights the inline viewer has always used; the studio keeps them. */
export const INLINE_LIGHT: LightLook = {
  hemisphere: 0.3,
  key: 2.0,
  keyColor: 0xffffff,
  rim: 0.35,
  environment: 1,
};

export const GROUND_RADIUS_M = 24;
const FOG_NEAR_M = 4;
const FOG_FAR_M = 22;

/** Relative luminance of an sRGB hex colour (WCAG), 0 black to 1 white. */
export const luminance = (hex: number): number => {
  const channel = (shift: number) => {
    const value = ((hex >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};

/** Below this the floor counts as dark for the contact pool's tint. */
const DARK_FLOOR = 0.18;

const world = (
  colours: Readonly<Pick<WorldLook, "skyTop" | "horizon" | "ground" | "grid">>,
  gridAlpha: number,
): WorldLook => ({
  ...colours,
  gridAlpha,
  fogNear: FOG_NEAR_M,
  fogFar: FOG_FAR_M,
  dark: luminance(colours.ground) < DARK_FLOOR,
});

/** The studio follows the site theme: a seamless floor that fades into a soft backdrop. */
const STUDIO: Readonly<Record<"dark" | "light", EnvironmentLook>> = {
  dark: {
    world: world(
      { skyTop: 0x262c38, horizon: 0x161a21, ground: 0x161a21, grid: 0x161a21 },
      0,
    ),
    light: INLINE_LIGHT,
  },
  light: {
    world: world(
      { skyTop: 0xf6f7f9, horizon: 0xdde1e7, ground: 0xdde1e7, grid: 0xdde1e7 },
      0,
    ),
    light: INLINE_LIGHT,
  },
};

type Keyframe = Readonly<{
  hour: number;
  skyTop: number;
  horizon: number;
  ground: number;
  grid: number;
  gridAlpha: number;
  light: LightLook;
}>;

/** Calm but not black: on a dim laptop screen the old near-black sky read as an empty view. */
const NIGHT = {
  skyTop: 0x1c2c4c,
  horizon: 0x3b4f74,
  ground: 0x2a3650,
  grid: 0x4b5e84,
  gridAlpha: 0.5,
  light: { hemisphere: 0.35, key: 1.6, keyColor: 0xc4d0ff, rim: 0.3, environment: 0.7 },
} as const;

/** Outdoors through one day; the first and last frames are the same night, so it wraps. */
export const OUTDOOR_KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, ...NIGHT },
  { hour: 5, ...NIGHT },
  {
    hour: 6.5,
    skyTop: 0x4a6fa5,
    horizon: 0xf2c6a0,
    ground: 0x6b6a70,
    grid: 0x8a8790,
    gridAlpha: 0.4,
    light: { hemisphere: 0.3, key: 1.6, keyColor: 0xffd9b8, rim: 0.35, environment: 0.8 },
  },
  {
    hour: 13,
    skyTop: 0x6fa8dc,
    horizon: 0xdfeaf3,
    ground: 0x9aa5ad,
    grid: 0xb8c2c9,
    gridAlpha: 0.4,
    light: INLINE_LIGHT,
  },
  {
    hour: 19,
    skyTop: 0x3b4f7d,
    horizon: 0xf0b48a,
    ground: 0x5f5a60,
    grid: 0x7d7780,
    gridAlpha: 0.4,
    light: { hemisphere: 0.3, key: 1.6, keyColor: 0xffcfa8, rim: 0.35, environment: 0.8 },
  },
  { hour: 21, ...NIGHT },
  { hour: 24, ...NIGHT },
];

/** Outdoors with "Follow local time" off. */
export const MIDDAY_HOUR = 13;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Channel by channel in sRGB, rounded, so a test can name the exact colour. */
export const mixHex = (a: number, b: number, t: number): number =>
  [16, 8, 0].reduce(
    (out, shift) =>
      out | (Math.round(mix((a >> shift) & 0xff, (b >> shift) & 0xff, t)) << shift),
    0,
  );

/** Hours past midnight on the device's own clock, minutes included. */
export const localHour = (date: Date): number => date.getHours() + date.getMinutes() / 60;

/** The outdoor look at an hour (0–24), between the two keyframes around it. */
export const outdoorsLook = (hour: number): EnvironmentLook => {
  const h = ((hour % 24) + 24) % 24;
  const nextIndex = OUTDOOR_KEYFRAMES.findIndex((frame) => frame.hour > h);
  const b = OUTDOOR_KEYFRAMES[nextIndex]!;
  const a = OUTDOOR_KEYFRAMES[nextIndex - 1]!;
  const t = (h - a.hour) / (b.hour - a.hour);
  return {
    world: world(
      {
        skyTop: mixHex(a.skyTop, b.skyTop, t),
        horizon: mixHex(a.horizon, b.horizon, t),
        ground: mixHex(a.ground, b.ground, t),
        grid: mixHex(a.grid, b.grid, t),
      },
      mix(a.gridAlpha, b.gridAlpha, t),
    ),
    light: {
      hemisphere: mix(a.light.hemisphere, b.light.hemisphere, t),
      key: mix(a.light.key, b.light.key, t),
      keyColor: mixHex(a.light.keyColor, b.light.keyColor, t),
      rim: mix(a.light.rim, b.light.rim, t),
      environment: mix(a.light.environment, b.light.environment, t),
    },
  };
};

/** The look for a preset. `hour` is null when the outdoor light should not follow the clock. */
export const lookFor = (
  preset: EnvironmentPreset,
  dark: boolean,
  hour: number | null,
): EnvironmentLook =>
  preset === "studio"
    ? STUDIO[dark ? "dark" : "light"]
    : outdoorsLook(hour ?? MIDDAY_HOUR);
