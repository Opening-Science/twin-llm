import { z } from "zod";

import {
  TWIN_FOCUS_IDS,
  TWIN_FOCUS_ORGANS,
  type TwinFocusId,
  type TwinFocusOrgan,
} from "@/packages/anatomy/twin-focus";

/**
 * One beat of a day: what happened, what a signal did, what that means in the
 * body, what the twin shows, and where the value comes from.
 *
 * Six fields: `time`, `event`, `signal`, `body`, `view`, `source`.
 *
 * `source` decides what `signal` may hold, in the type and in the parser:
 *
 * - `measured`: a stored reading. The signal carries its value and unit.
 * - `derived`: computed from measured readings (a peak, a window past a
 *   threshold). It carries a value and unit too.
 * - `narrated`: a description of what usually happens, never a reading. Its
 *   value and unit are `null`, so no number can be shown as if measured.
 *
 * Insulin is never measured here: it has no measured or derived form, only
 * a narrated one.
 *
 * A glucose value names its `specimen`: `blood` (a finger prick or a lab) or
 * `sensor` (a continuous monitor reading the fluid between cells, several
 * minutes behind the blood). The two are never compared with each other.
 */

export const BEAT_SOURCES = ["measured", "derived", "narrated"] as const;
export type BeatSource = (typeof BEAT_SOURCES)[number];

export const DIRECTIONS = ["up", "down", "steady"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Twin layer the view opens at; `layers.ts` order. */
export const VIEW_DEPTHS = ["scan", "muscle", "skeleton", "organs"] as const;
export type ViewDepth = (typeof VIEW_DEPTHS)[number];

export const GLUCOSE_SPECIMENS = ["blood", "sensor"] as const;
export type GlucoseSpecimen = (typeof GLUCOSE_SPECIMENS)[number];

/** A value with its unit: only heart rate and glucose are ever read. */
export type ValuedSignal = Readonly<
  | { measure: "heart_rate"; direction: Direction; value: number; unit: "/min" }
  | {
      measure: "glucose";
      specimen: GlucoseSpecimen;
      direction: Direction;
      value: number;
      unit: "mg/dL";
    }
>;

/** A described change with no number: the only form insulin takes. */
export type NarratedSignal = Readonly<{
  measure: "heart_rate" | "glucose" | "insulin";
  direction: Direction;
  value: null;
  unit: null;
}>;

type BeatBase = Readonly<{
  /** Wall-clock time, "HH:MM", in the time zone the result names (UTC for now). */
  time: string;
  /** What the person was doing, or "Reading" when nothing is recorded. */
  event: string;
  /** One or two sentences on what happens in the body, and where. */
  body: Readonly<{ text: string; organ: TwinFocusOrgan }>;
  /** What the twin shows for this beat. */
  view: Readonly<{ focus: TwinFocusId; depth: ViewDepth }>;
}>;

export type DayBeat = BeatBase &
  (
    | Readonly<{ source: "measured" | "derived"; signal: ValuedSignal }>
    | Readonly<{ source: "narrated"; signal: NarratedSignal }>
  );

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const base = {
  time: z.string().regex(TIME),
  event: z.string().min(1).max(80),
  body: z
    .object({ text: z.string().min(1).max(280), organ: z.enum(TWIN_FOCUS_ORGANS) })
    .strict(),
  view: z.object({ focus: z.enum(TWIN_FOCUS_IDS), depth: z.enum(VIEW_DEPTHS) }).strict(),
};

const valuedSignal = z.discriminatedUnion("measure", [
  z
    .object({
      measure: z.literal("heart_rate"),
      direction: z.enum(DIRECTIONS),
      value: z.number().finite(),
      unit: z.literal("/min"),
    })
    .strict(),
  z
    .object({
      measure: z.literal("glucose"),
      specimen: z.enum(GLUCOSE_SPECIMENS),
      direction: z.enum(DIRECTIONS),
      value: z.number().finite(),
      unit: z.literal("mg/dL"),
    })
    .strict(),
]);

const narratedSignal = z
  .object({
    measure: z.enum(["heart_rate", "glucose", "insulin"]),
    direction: z.enum(DIRECTIONS),
    value: z.null(),
    unit: z.null(),
  })
  .strict();

/** The parser for a beat; it refuses a narrated value and a measured insulin. */
export const dayBeatSchema = z.discriminatedUnion("source", [
  z.object({ ...base, source: z.literal("measured"), signal: valuedSignal }).strict(),
  z.object({ ...base, source: z.literal("derived"), signal: valuedSignal }).strict(),
  z.object({ ...base, source: z.literal("narrated"), signal: narratedSignal }).strict(),
]);

const signalName = (beat: DayBeat): string => {
  if (beat.signal.measure === "heart_rate") return "Heart rate";
  if (beat.signal.measure === "insulin") return "Insulin";
  return beat.source !== "narrated" && beat.signal.specimen === "sensor"
    ? "Sensor glucose"
    : "Blood glucose";
};

/** How a beat's value reads on screen: a narrated beat never shows a number. */
export const signalText = (beat: DayBeat): string => {
  const name = signalName(beat);
  if (beat.source === "narrated")
    return `${name} ${beat.signal.direction} · narrated, not measured`;
  return `${name} ${beat.signal.direction} · about ${Math.round(beat.signal.value)} ${beat.signal.unit} · ${beat.source}`;
};
