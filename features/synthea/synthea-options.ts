import { z } from "zod";

/**
 * The closed set of choices the Synthea page offers, and the schema that checks
 * a request against it. Nothing a person types reaches the Java command line:
 * every value here is a number in a range or one of the fixed keys below, and
 * `synthea-args.ts` turns those keys into arguments from its own tables.
 *
 * Shared by the form (client) and the job route (server), so it has no I/O.
 */

/** Synthea v4.0.0, the same JAR `scripts/synthea/generate-local.sh` pins. */
export { SYNTHEA_JAR_SHA256, SYNTHEA_VERSION } from "@/infrastructure/local-artefacts";

/**
 * Synthea simulates up to "now" unless given dates, so the same seed would give
 * other people on another day. Every run ends on this date, like the cohort
 * presets, so a seed always gives the same files.
 */
export const SYNTHEA_REFERENCE_DATE = "20260101";

export const MAX_SEED = 2_147_483_647;
export const MAX_AGE = 100;

/** The 50 US states and DC, as Synthea's demographics file names them. */
export const SYNTHEA_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
] as const;

export type SyntheaState = (typeof SYNTHEA_STATES)[number];

/**
 * Disease modules a run can be narrowed to. Each key maps to Synthea module
 * file names (without `.json`) in the v4.0.0 JAR. Leaving the list empty runs
 * every module, which is Synthea's default.
 */
export const SYNTHEA_MODULES = {
  asthma: { label: "Asthma", files: ["asthma"] },
  copd: { label: "COPD", files: ["copd"] },
  "atrial-fibrillation": { label: "Atrial fibrillation", files: ["atrial_fibrillation"] },
  "heart-failure": { label: "Heart failure", files: ["congestive_heart_failure"] },
  hypertension: { label: "Hypertension", files: ["hypertension"] },
  "kidney-disease": {
    label: "Chronic kidney disease",
    files: ["chronic_kidney_disease"],
  },
  "metabolic-syndrome": {
    label: "Metabolic syndrome and diabetes",
    files: ["metabolic_syndrome_disease", "metabolic_syndrome_care"],
  },
  dementia: { label: "Dementia", files: ["dementia"] },
  osteoarthritis: { label: "Osteoarthritis", files: ["osteoarthritis"] },
  "sleep-apnea": { label: "Sleep apnea", files: ["sleep_apnea"] },
} as const satisfies Readonly<
  Record<string, Readonly<{ label: string; files: readonly string[] }>>
>;

export type SyntheaModule = keyof typeof SYNTHEA_MODULES;

export const SYNTHEA_MODULE_KEYS = Object.keys(SYNTHEA_MODULES) as [
  SyntheaModule,
  ...SyntheaModule[],
];

/**
 * Modules that always run when the list is narrowed, so people still have
 * check-ups, vital signs and lab panels; without them a narrowed run gives
 * records with almost no observations.
 */
export const SYNTHEA_CORE_MODULE_FILES = [
  "wellness_encounters",
  "allergies",
  "med_rec",
] as const;

export const SYNTHEA_SEXES = ["any", "female", "male"] as const;
export type SyntheaSex = (typeof SYNTHEA_SEXES)[number];

export const SYNTHEA_FORMATS = ["fhir", "csv"] as const;
export type SyntheaFormat = (typeof SYNTHEA_FORMATS)[number];

export const SYNTHEA_FORMAT_LABELS: Readonly<Record<SyntheaFormat, string>> = {
  fhir: "FHIR R4 bundles (one JSON file per person)",
  csv: "CSV tables (patients, conditions, observations, …)",
};

const uniqueList = <T extends string>(values: readonly T[]): boolean =>
  new Set(values).size === values.length;

/** The schema for a request, with the people cap this server allows. */
export const syntheaOptionsSchema = (maxPeople: number) =>
  z
    .object({
      people: z
        .number()
        .int()
        .min(1, "Ask for at least 1 person")
        .max(maxPeople, `This server makes at most ${maxPeople} people per run`),
      seed: z.number().int().min(0).max(MAX_SEED).nullable(),
      ageMin: z.number().int().min(0).max(MAX_AGE),
      ageMax: z.number().int().min(0).max(MAX_AGE),
      sex: z.enum(SYNTHEA_SEXES),
      state: z.enum(SYNTHEA_STATES),
      modules: z
        .array(z.enum(SYNTHEA_MODULE_KEYS))
        .max(SYNTHEA_MODULE_KEYS.length)
        .refine(uniqueList, "Each module once"),
      formats: z
        .array(z.enum(SYNTHEA_FORMATS))
        .min(1, "Pick at least one output format")
        .refine(uniqueList, "Each format once"),
    })
    .strict()
    .refine((options) => options.ageMin <= options.ageMax, {
      message: "The lowest age must not be above the highest",
      path: ["ageMax"],
    });

export type SyntheaOptions = Readonly<z.infer<ReturnType<typeof syntheaOptionsSchema>>>;

export const DEFAULT_SYNTHEA_OPTIONS: SyntheaOptions = {
  people: 5,
  seed: null,
  ageMin: 18,
  ageMax: 80,
  sex: "any",
  state: "Massachusetts",
  modules: [],
  formats: ["fhir"],
};

export type ParsedOptions =
  | Readonly<{ ok: true; options: SyntheaOptions }>
  | Readonly<{ ok: false; message: string }>;

/** Checks an untrusted request body; the message is a plain sentence. */
export const parseSyntheaOptions = (body: unknown, maxPeople: number): ParsedOptions => {
  const parsed = syntheaOptionsSchema(maxPeople).safeParse(body);
  if (parsed.success) return { ok: true, options: parsed.data };
  const first = parsed.error.issues[0];
  // Only messages written above are shown; zod's own wording is not for people.
  const ours =
    first !== undefined &&
    (first.code === "custom" ||
      (first.code === "too_small" && first.path[0] === "formats") ||
      (first.path[0] === "people" &&
        (first.code === "too_big" || first.code === "too_small")));
  return {
    ok: false,
    message:
      ours && first !== undefined
        ? first.message
        : "Some options are not ones this page offers. Reload the page and try again.",
  };
};
