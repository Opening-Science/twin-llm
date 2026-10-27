import { z } from "zod";

/**
 * Ark CLI 0.5.0 JSON contracts (ArkOS 0.13.1). Extra keys pass through so a
 * firmware addition does not break parse; pin the tool version in docs/ark.md.
 */

export const ARK_CLI_VERSION = "0.5.0" as const;
export const ARK_FIRMWARE_VERSION = "0.13.1" as const;
export const ARK_PATH_PREFIX = "v1/genome" as const;

/** The slots `ark data list` names, in its order. */
export const ARK_SLOT_NAMES = [
  "reference-genome",
  "gene-annotations",
  "small-variants",
  "structural-variants",
  "copy-number-variants",
  "variant-catalog",
] as const;

export type ArkSlotName = (typeof ARK_SLOT_NAMES)[number];

const decimal = z.union([z.string(), z.number()]);

export const arkErrorObjectSchema = z.looseObject({
  code: z.string(),
  message: z.string(),
  hints: z.array(z.string()).optional(),
  /** CLI 0.5.0: the Ark's own code and message on an error[ark] refusal. */
  remote: z
    .looseObject({ code: decimal.optional(), message: z.string().optional() })
    .nullable()
    .optional(),
  remote_code: z.string().optional(),
  remote_message: z.string().optional(),
});

export const arkErrorDocumentSchema = z.looseObject({
  error: arkErrorObjectSchema,
});

export const arkReadingEventSchema = z.looseObject({
  event: z.enum(["progress", "note", "warning", "approve", "hint", "step"]),
  message: z.string(),
});

export const arkLogEventSchema = z.looseObject({
  event: z.literal("log"),
  level: z.string(),
  target: z.string(),
  fields: z.unknown(),
});

export const arkErrorEventSchema = z.looseObject({
  event: z.literal("error"),
  error: arkErrorObjectSchema,
});

export const arkStderrEventSchema = z.union([
  arkReadingEventSchema,
  arkLogEventSchema,
  arkErrorEventSchema,
]);

/**
 * `ark status --json`. Serial, model, environment and realm come from the
 * attestation, so a self-signed Ark (a fresh emulator) reports them as null.
 */
export const arkStatusDocumentSchema = z.looseObject({
  name: z.string().nullable(),
  serial: z.string().nullable(),
  hardware: z.looseObject({
    version: z.string(),
    revision: z.string(),
    model: z.string().nullable(),
  }),
  firmware: z.looseObject({
    version: z.string(),
    published: z.string().nullable(),
  }),
  trust: z.string(),
  environment: z.string().nullable(),
  realm: z.string().nullable(),
  synced: z.boolean().nullable(),
  paired: z.boolean().nullable(),
  unlocked: z.boolean().nullable(),
  identity: z.string(),
  mismatch: z.unknown().nullable(),
  pubkey: z.string().optional(),
});

export const formatZodIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

export const arkSlotSchema = z.looseObject({
  slot: decimal,
  id: decimal.optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  state: z.string(),
  origin: z.string().nullable().optional(),
  damage: z.unknown().nullable().optional(),
  requires: z.unknown().optional(),
  size_bytes: decimal.nullable().optional(),
  /** The assembly the slot's data is on, such as GRCh38.p14. */
  build: z.string().nullable().optional(),
  /** The variant catalog's dbSNP release, such as 157; null for other slots. */
  version: decimal.nullable().optional(),
  download: z.unknown().nullable().optional(),
});

export const arkDataListDocumentSchema = z.looseObject({
  slots: z.array(arkSlotSchema),
});

export const arkPathSchema = z.looseObject({
  path: z.string(),
  directory: z.boolean(),
  grantable: z.boolean(),
  available: z.boolean(),
  description: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  examples: z.unknown().optional(),
  public: z.boolean().optional(),
  wording: z.string().nullable().optional(),
});

export const arkDataPathsDocumentSchema = z.looseObject({
  paths: z.array(arkPathSchema),
});

/** `ark run FILE --json` (CLI 0.5.0). `paths` are the grants the Ark mounted. */
export const arkAppRunDocumentSchema = z.looseObject({
  task: z.string(),
  app: z.looseObject({
    name: z.string(),
    version: z.string(),
    develop: z.boolean(),
  }),
  success: z.boolean(),
  paths: z.array(z.string()),
  media: z.string().nullable().optional(),
  stdout: z.string().optional(),
  stdout_base64: z.string().optional(),
  stderr: z.string().optional(),
  stderr_base64: z.string().optional(),
  duration_seconds: decimal,
});

/** `ark doctor --json`: each check is ok, warn, fail or skip. */
export const arkDoctorDocumentSchema = z.looseObject({
  version: z.string(),
  checks: z.array(
    z.looseObject({
      name: z.string(),
      result: z.enum(["ok", "warn", "fail", "skip"]),
      detail: z.string().nullable().optional(),
      hint: z.string().nullable().optional(),
    }),
  ),
});

/** What leaves the adapter from doctor: check names and results, no details. */
export type ArkDoctorSafe = Readonly<{
  version: string;
  checks: readonly Readonly<{ name: string; result: "ok" | "warn" | "fail" | "skip" }>[];
}>;

export const redactDoctorDocument = (
  document: z.infer<typeof arkDoctorDocumentSchema>,
): ArkDoctorSafe => ({
  version: document.version,
  checks: document.checks.map(({ name, result }) => ({ name, result })),
});

export type ArkErrorObject = z.infer<typeof arkErrorObjectSchema>;
export type ArkErrorDocument = z.infer<typeof arkErrorDocumentSchema>;
export type ArkStderrEvent = z.infer<typeof arkStderrEventSchema>;
export type ArkStatusDocument = z.infer<typeof arkStatusDocumentSchema>;
export type ArkDataListDocument = z.infer<typeof arkDataListDocumentSchema>;
export type ArkDataPathsDocument = z.infer<typeof arkDataPathsDocumentSchema>;
export type ArkAppRunDocument = z.infer<typeof arkAppRunDocumentSchema>;

export type ArkStatusSafe = Omit<ArkStatusDocument, "pubkey">;

export const redactStatusDocument = (document: ArkStatusDocument): ArkStatusSafe => {
  const { pubkey: _pubkey, ...safe } = document;
  return safe;
};

export const allPathsStartWithGenome = (
  paths: readonly { readonly path: string }[],
): boolean => paths.every((entry) => entry.path.startsWith(ARK_PATH_PREFIX));

export const parseJsonValue = (text: string): unknown => JSON.parse(text) as unknown;

export const parseStderrEvents = (stderr: string): ArkStderrEvent[] =>
  stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = arkStderrEventSchema.safeParse(parseJsonValue(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });

export const stderrErrorObject = (
  events: readonly ArkStderrEvent[],
): ArkErrorObject | null => {
  const match = events.find((event) => event.event === "error");
  return match && match.event === "error" ? match.error : null;
};

export const isErrorDocument = (value: unknown): value is ArkErrorDocument =>
  arkErrorDocumentSchema.safeParse(value).success &&
  typeof value === "object" &&
  value !== null &&
  !("serial" in value) &&
  !("slots" in value) &&
  !("paths" in value) &&
  !("task" in value) &&
  !("checks" in value);
