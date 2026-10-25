import { z } from "zod";

/**
 * Ark CLI 0.3.5 JSON contracts. Extra keys pass through so a firmware
 * addition does not break parse; pin the tool version in docs/ark.md.
 */

export const ARK_CLI_VERSION = "0.3.5" as const;
export const ARK_PATH_PREFIX = "v1/genome" as const;

export const ARK_SLOT_NAMES = [
  "reference-genome",
  "gene-annotations",
  "snp-indel-calls",
  "variant-catalog",
] as const;

export type ArkSlotName = (typeof ARK_SLOT_NAMES)[number];

const decimal = z.union([z.string(), z.number()]);

export const arkErrorObjectSchema = z.looseObject({
  code: z.string(),
  message: z.string(),
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

export const arkStatusDocumentSchema = z.looseObject({
  name: z.string().nullable(),
  serial: z.string(),
  hardware: z.looseObject({
    version: z.string(),
    revision: z.string(),
    model: z.string(),
  }),
  firmware: z.looseObject({
    version: z.string(),
    published: z.string().nullable(),
  }),
  trust: z.string(),
  environment: z.string(),
  realm: z.string(),
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
  build: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
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
});

export const arkDataPathsDocumentSchema = z.looseObject({
  paths: z.array(arkPathSchema),
});

export const arkAppRunDocumentSchema = z.looseObject({
  task: z.string(),
  app: z.string(),
  success: z.boolean(),
  stdout: z.string().optional(),
  stdout_base64: z.string().optional(),
  stderr: z.string().optional(),
  stderr_base64: z.string().optional(),
  duration_seconds: decimal,
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
  !("task" in value);
