import { z } from "zod";

import { SALT_PATTERN } from "./rater-lines";
import { RUBRIC_VERSION } from "./rater-rubric";

/**
 * A rater's rating set (#355): the random salt that keys the rater's answer
 * ids and order, made when the set starts and kept on the server at
 * `evaluation/rater-sets/<rater>.json` (format in
 * `docs/evaluation/second-rater.md`). It is never sent to the browser and
 * never part of the export. Pure: the loader makes the salt and does the I/O.
 */

export const RATER_SET_SCHEMA_VERSION = "twin-llm.eval.rater-set.v1";

export const raterSetSchema = z
  .object({
    schema_version: z.literal(RATER_SET_SCHEMA_VERSION),
    rubric: z.string(),
    rater: z.string().min(1),
    salt: z.string().regex(SALT_PATTERN),
    created: z.string(),
  })
  .strict();

export type RaterSet = z.infer<typeof raterSetSchema>;

/** The set, or null when the text is not a rater set of this version. */
export const parseRaterSet = (text: string): RaterSet | null => {
  try {
    const parsed = raterSetSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const newRaterSet = (rater: string, salt: string, now: string): RaterSet => ({
  schema_version: RATER_SET_SCHEMA_VERSION,
  rubric: RUBRIC_VERSION,
  rater,
  salt,
  created: now,
});

/** The set as written to disk: two-space JSON with a final newline. */
export const renderRaterSet = (set: RaterSet): string =>
  `${JSON.stringify(set, null, 2)}\n`;
