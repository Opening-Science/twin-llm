import { z } from "zod";

import { TWIN_FOCUS_IDS } from "@/packages/anatomy/twin-focus";

import { GLUCOSE_SPECIMENS } from "../day-beat";
import { isCalendarDay, isTimeZone } from "./local-time";

/**
 * What a day replay is made of: readings, context events and narration, each
 * carrying the person, the local day and its time zone, where it comes from,
 * and how we know it. Shared by the playback clock, the day dashboard, the
 * 3D animation and the ten-night view (#862), so none of them decides on its
 * own what a value means.
 *
 * Every item has a `provenance`, and the parsers enforce what each allows:
 *
 * - `measured`: a device recorded it. Names the device.
 * - `entered`: the person entered it (a tag such as "Breakfast"). Names the person as source.
 * - `derived`: computed here from other items. Names the rule and the items it used.
 * - `narrated`: a description of what usually happens in a body. Never a value.
 *
 * Insulin and other hormones are only ever narrated: no reading stream holds
 * them, and narration carries no number at all.
 *
 * `origin` keeps recordings and synthetic demonstrations apart: a day is one or
 * the other, and a demo item says so even when it demonstrates a measured value.
 */

export const PROVENANCES = ["measured", "derived", "entered", "narrated"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const ORIGINS = ["recorded", "synthetic_demo"] as const;
export type Origin = (typeof ORIGINS)[number];

export const SOURCE_KINDS = ["device", "person", "twin_llm"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** The kind of source each provenance must name. */
export const SOURCE_FOR: Readonly<Record<Provenance, SourceKind>> = {
  measured: "device",
  entered: "person",
  derived: "twin_llm",
  narrated: "twin_llm",
};

/**
 * The streams a reading can hold, and the one unit each is stored in. Resting
 * heart rate and HRV (RMSSD) are a device's nightly values: one reading per
 * night, at the night's end, standing for the whole night.
 */
export const STREAM_UNITS = {
  heart_rate: "/min",
  glucose: "mg/dL",
  steps: "steps",
  resting_heart_rate: "/min",
  hrv_rmssd: "ms",
} as const;
export type ReadingStream = keyof typeof STREAM_UNITS;
export const READING_STREAMS = Object.keys(STREAM_UNITS) as readonly ReadingStream[];

/** What a narration can be about; insulin appears here and nowhere else. */
export const NARRATION_TOPICS = ["heart_rate", "glucose", "insulin", "body"] as const;

export const EVENT_KINDS = ["sleep", "activity", "meal", "tag"] as const;
export const ACTIVITIES = ["walk", "run"] as const;
export const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;

/**
 * Why a reading is missing, in the words shown to the person. A closed set we
 * wrote ourselves: a provider's error text never becomes a reason, because the
 * replay shows the reason as it is. An adapter maps what its source reports to
 * one of these, or to "No value from the device".
 */
export const MISSING_REASONS = [
  "New sensor warming up",
  "Ring off the finger",
  "Watch off the wrist",
  "No value from the device",
] as const;
export type MissingReason = (typeof MISSING_REASONS)[number];

const instant = z.iso.datetime();

/** Person, local day, zone and origin: on every item, so items cannot drift apart. */
const scope = {
  subject_ref: z.string().min(1).max(120),
  day: z.string().refine(isCalendarDay, "not a calendar day"),
  time_zone: z.string().refine(isTimeZone, "not a known time zone"),
  origin: z.enum(ORIGINS),
};

const sourceSchema = z
  .object({ kind: z.enum(SOURCE_KINDS), name: z.string().min(1).max(80) })
  .strict();

/** The rule a derived item followed, by id and in words. */
const ruleSchema = z
  .object({ id: z.string().min(1).max(80), text: z.string().min(1).max(280) })
  .strict();

const valuedProvenance = z.enum(["measured", "derived", "entered"]);

type ProvenanceFields = Readonly<{
  provenance: Provenance;
  source: Readonly<{ kind: SourceKind }>;
  rule?: unknown;
  evidence?: readonly string[];
}>;

/**
 * The provenance rule, one place for every item: the source fits the
 * provenance, and only a derived item names a rule and its evidence.
 */
export const provenanceIssues = (item: ProvenanceFields): readonly string[] => {
  const wrongSource =
    item.source.kind === SOURCE_FOR[item.provenance]
      ? []
      : [`${item.provenance} items name a ${SOURCE_FOR[item.provenance]} source`];
  const derived = item.provenance === "derived";
  const hasRule = item.rule !== undefined;
  const hasEvidence = (item.evidence?.length ?? 0) > 0;
  const derivation =
    derived && !(hasRule && hasEvidence)
      ? ["a derived item names its rule and the items it used"]
      : !derived && (hasRule || item.evidence !== undefined)
        ? ["only a derived item names a rule and evidence"]
        : [];
  return [...wrongSource, ...derivation];
};

const addIssues =
  <T>(check: (item: T) => readonly string[]) =>
  (item: T, context: z.RefinementCtx): void => {
    check(item).forEach((message) => context.addIssue({ code: "custom", message }));
  };

const readingBase = {
  ...scope,
  id: z.string().min(1).max(120),
  /** When the reading applies, as a UTC instant. */
  at: instant,
  /** How much time one reading stands for: 1 for a per-minute heart rate, 15 for a 15-minute step count. */
  interval_min: z.number().positive().max(1440),
  provenance: valuedProvenance,
  source: sourceSchema,
  rule: ruleSchema.optional(),
  evidence: z.array(z.string().min(1)).optional(),
  /**
   * `missing` when the source reported no value for this time (a sensor
   * warming up, a watch off the wrist): the gap stays a gap, `value` is null.
   */
  availability: z.enum(["available", "missing"]),
  missing_reason: z.enum(MISSING_REASONS).optional(),
};

const readingSchemaBase = z.discriminatedUnion("stream", [
  z
    .object({
      ...readingBase,
      stream: z.literal("heart_rate"),
      unit: z.literal(STREAM_UNITS.heart_rate),
      value: z.number().finite().positive().nullable(),
    })
    .strict(),
  z
    .object({
      ...readingBase,
      stream: z.literal("glucose"),
      unit: z.literal(STREAM_UNITS.glucose),
      /** Blood (a finger prick, a lab) or sensor (a continuous monitor); never compared. */
      specimen: z.enum(GLUCOSE_SPECIMENS),
      value: z.number().finite().positive().nullable(),
    })
    .strict(),
  z
    .object({
      ...readingBase,
      stream: z.literal("steps"),
      unit: z.literal(STREAM_UNITS.steps),
      value: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      ...readingBase,
      stream: z.literal("resting_heart_rate"),
      unit: z.literal(STREAM_UNITS.resting_heart_rate),
      value: z.number().finite().positive().nullable(),
    })
    .strict(),
  z
    .object({
      ...readingBase,
      stream: z.literal("hrv_rmssd"),
      unit: z.literal(STREAM_UNITS.hrv_rmssd),
      value: z.number().finite().positive().nullable(),
    })
    .strict(),
]);

const availabilityIssues = (
  reading: Readonly<{
    availability: "available" | "missing";
    value: number | null;
    missing_reason?: string;
  }>,
): readonly string[] => {
  if (reading.availability === "available") {
    return reading.value === null
      ? ["an available reading has a value"]
      : reading.missing_reason === undefined
        ? []
        : ["only a missing reading gives a reason"];
  }
  return reading.value !== null
    ? ["a missing reading has no value; never fill one in"]
    : reading.missing_reason === undefined
      ? ["a missing reading says why"]
      : [];
};

/** The parser for one reading. */
export const replayReadingSchema = readingSchemaBase.superRefine(
  addIssues((reading: z.infer<typeof readingSchemaBase>) => [
    ...provenanceIssues(reading),
    ...availabilityIssues(reading),
  ]),
);

export type ReplayReading = Readonly<z.infer<typeof replayReadingSchema>>;
export type AvailableReading = ReplayReading & Readonly<{ value: number }>;

export const isAvailable = (reading: ReplayReading): reading is AvailableReading =>
  reading.availability === "available" && reading.value !== null;

const eventSchemaBase = z
  .object({
    ...scope,
    id: z.string().min(1).max(120),
    kind: z.enum(EVENT_KINDS),
    /** The words to show, such as "Walk" or the person's own tag. */
    label: z.string().min(1).max(80),
    activity: z.enum(ACTIVITIES).optional(),
    meal: z.enum(MEALS).optional(),
    from: instant,
    to: instant,
    provenance: valuedProvenance,
    source: sourceSchema,
    rule: ruleSchema.optional(),
    evidence: z.array(z.string().min(1)).optional(),
  })
  .strict();

const eventShapeIssues = (event: z.infer<typeof eventSchemaBase>): readonly string[] => [
  ...(Date.parse(event.to) < Date.parse(event.from)
    ? ["an event ends after it starts"]
    : []),
  ...((event.kind === "activity") !== (event.activity !== undefined)
    ? ["an activity event, and only one, names its activity"]
    : []),
  ...((event.kind === "meal") !== (event.meal !== undefined)
    ? ["a meal event, and only one, names its meal"]
    : []),
  ...((event.kind === "meal" || event.kind === "tag") && event.provenance !== "entered"
    ? ["a meal or a tag is entered by the person"]
    : []),
];

/** The parser for a context event: sleep and activity from a device, meals and tags the person entered. */
export const replayEventSchema = eventSchemaBase.superRefine(
  addIssues((event: z.infer<typeof eventSchemaBase>) => [
    ...provenanceIssues(event),
    ...eventShapeIssues(event),
  ]),
);

export type ReplayEvent = Readonly<z.infer<typeof replayEventSchema>>;

const DIGIT = /\d/;

/**
 * The parser for narration: what usually happens in a body, never this
 * person's measurement. It has no value field, and its text holds no digit,
 * so it cannot carry a hormone amount or a number that reads as measured.
 */
export const replayNarrationSchema = z
  .object({
    ...scope,
    id: z.string().min(1).max(120),
    provenance: z.literal("narrated"),
    source: sourceSchema.extend({ kind: z.literal("twin_llm") }),
    topic: z.enum(NARRATION_TOPICS),
    text: z
      .string()
      .min(1)
      .max(280)
      .refine((text) => !DIGIT.test(text), "narration carries no number"),
    /** Where on the twin the narration is about. */
    focus: z.enum(TWIN_FOCUS_IDS),
    from: instant,
    to: instant,
  })
  .strict()
  .refine(
    (narration) => Date.parse(narration.to) >= Date.parse(narration.from),
    "a narration ends after it starts",
  );

export type ReplayNarration = Readonly<z.infer<typeof replayNarrationSchema>>;
