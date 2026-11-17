import { z } from "zod";

import { TWIN_FOCUS_IDS, TWIN_FOCUS_ORGANS } from "@/packages/anatomy/twin-focus";

import {
  BEAT_SOURCES,
  type DayBeat,
  DIRECTIONS,
  GLUCOSE_SPECIMENS,
  signalText,
  VIEW_DEPTHS,
} from "./day-beat";
import { GLUCOSE_PROFILES, type RedWindow, WINDOW_EVENT } from "./day-beats";

/**
 * The kiosk's view of one day: what open-twin-xr reads to play a day on the
 * twin. A flat, display-ready form of a `show_my_day` result: each beat
 * carries the line to show (`signalText`), whether it is worth a look, and
 * where the twin turns. The contract is `docs/kiosk-day.md`; this schema is
 * its source of truth and `docs/kiosk-day.example.json` is its example.
 *
 * Rules the kiosk relies on, held by the schema:
 * - a narrated beat has `value` and `unit` null, and insulin is always narrated;
 * - `worth_a_look` is true only on a derived beat;
 * - a glucose value names its specimen, blood or sensor, and nothing else does;
 * - the thresholds say they are placeholders until Robin confirms them.
 */

export const KIOSK_DAY_SCHEMA_VERSION = "twin-llm.kiosk-day.v1";

export const KIOSK_DAY_NOTICE =
  "An illustration on a synthetic person. Not a recording of anyone, and not advice.";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const kioskBeat = z
  .object({
    time: z.string().regex(TIME),
    event: z.string().min(1),
    source: z.enum(BEAT_SOURCES),
    measure: z.enum(["heart_rate", "glucose", "insulin"]),
    /** Blood or sensor on a glucose value; null on heart rate, insulin and a narrated beat. */
    specimen: z.enum(GLUCOSE_SPECIMENS).nullable(),
    direction: z.enum(DIRECTIONS),
    value: z.number().finite().nullable(),
    unit: z.enum(["/min", "mg/dL"]).nullable(),
    /** The value line to show, exactly. */
    line: z.string().min(1),
    body: z
      .object({ text: z.string().min(1), organ: z.enum(TWIN_FOCUS_ORGANS) })
      .strict(),
    view: z
      .object({ focus: z.enum(TWIN_FOCUS_IDS), depth: z.enum(VIEW_DEPTHS) })
      .strict(),
    worth_a_look: z.boolean(),
  })
  .strict()
  .superRefine((beat, ctx) => {
    const narrated = beat.source === "narrated";
    if (narrated !== (beat.value === null) || narrated !== (beat.unit === null)) {
      ctx.addIssue({ code: "custom", message: "only a narrated beat has no value" });
    }
    if (beat.measure === "insulin" && !narrated) {
      ctx.addIssue({ code: "custom", message: "insulin is narrated only" });
    }
    if (beat.worth_a_look && beat.source !== "derived") {
      ctx.addIssue({ code: "custom", message: "only a derived beat is worth a look" });
    }
    if ((beat.measure === "glucose" && !narrated) !== (beat.specimen !== null)) {
      ctx.addIssue({ code: "custom", message: "only a glucose value names a specimen" });
    }
  });

const kioskWindow = z
  .object({
    from: z.string().regex(TIME),
    to: z.string().regex(TIME),
    measure: z.enum(["heart_rate", "glucose"]),
    /** Blood or sensor on a glucose window; null on heart rate. */
    specimen: z.enum(GLUCOSE_SPECIMENS).nullable(),
    extreme: z.number().finite(),
    unit: z.enum(["/min", "mg/dL"]),
    rule: z.string().min(1),
  })
  .strict()
  .refine((window) => (window.measure === "glucose") === (window.specimen !== null), {
    message: "only a glucose window names a specimen",
  });

export const kioskDaySchema = z
  .object({
    schema_version: z.literal(KIOSK_DAY_SCHEMA_VERSION),
    notice: z.literal(KIOSK_DAY_NOTICE),
    subject_ref: z.string().min(1),
    day: z.iso.date(),
    profile: z.enum(GLUCOSE_PROFILES),
    beats: z.array(kioskBeat),
    worth_a_look: z.array(kioskWindow),
    thresholds: z
      .object({ status: z.literal("placeholder"), reviewer: z.string().min(1) })
      .strict(),
    /** "not recorded" for a warehouse day: no events, no moving or still. */
    activity: z.enum(["recorded", "not recorded"]),
    /** Beat and window times are wall-clock times in this zone. */
    timezone: z.literal("UTC"),
  })
  .strict();

export type KioskDay = z.infer<typeof kioskDaySchema>;

/** What `toKioskDay` reads: the fields of a `show_my_day` result it uses. */
export type KioskDaySource = Readonly<{
  subject_ref: string;
  day: string;
  profile: (typeof GLUCOSE_PROFILES)[number];
  beats: readonly DayBeat[];
  red_windows: readonly RedWindow[];
  thresholds: Readonly<{ status: "placeholder"; reviewer: string }>;
  activity: "recorded" | "not recorded";
  timezone: "UTC";
}>;

const kioskBeatOf = (beat: DayBeat): z.infer<typeof kioskBeat> => ({
  time: beat.time,
  event: beat.event,
  source: beat.source,
  measure: beat.signal.measure,
  specimen:
    beat.source !== "narrated" && beat.signal.measure === "glucose"
      ? beat.signal.specimen
      : null,
  direction: beat.signal.direction,
  value: beat.signal.value,
  unit: beat.signal.unit,
  line: signalText(beat),
  body: { text: beat.body.text, organ: beat.body.organ },
  view: { focus: beat.view.focus, depth: beat.view.depth },
  worth_a_look: beat.source === "derived" && beat.event === WINDOW_EVENT,
});

/** A `show_my_day` result in the kiosk's shape, checked against the contract. */
export const toKioskDay = (result: KioskDaySource): KioskDay =>
  kioskDaySchema.parse({
    schema_version: KIOSK_DAY_SCHEMA_VERSION,
    notice: KIOSK_DAY_NOTICE,
    subject_ref: result.subject_ref,
    day: result.day,
    profile: result.profile,
    beats: result.beats.map(kioskBeatOf),
    worth_a_look: result.red_windows.map((window) => ({
      from: window.from,
      to: window.to,
      measure: window.measure,
      specimen: window.specimen,
      extreme: window.extreme,
      unit: window.measure === "heart_rate" ? "/min" : "mg/dL",
      rule: window.rule,
    })),
    thresholds: {
      status: result.thresholds.status,
      reviewer: result.thresholds.reviewer,
    },
    activity: result.activity,
    timezone: result.timezone,
  });
