import { z } from "zod";

import { RATER_SETS_DIR } from "@/infrastructure/local-artefacts";

import { SALT_PATTERN } from "./rater-lines";
import { type RatedSet, RUBRIC_VERSION } from "./rater-rubric";

/**
 * A rater's rating set (#355): the random salt that keys the rater's answer
 * ids and order, made when the set starts and kept on the server at
 * `evaluation/rater-sets/<rater>.json` for hb and
 * `evaluation/rater-sets/<set>/<rater>.json` for any other rated set (#304),
 * so each set has its own salt (format in `docs/evaluation/second-rater.md`). It is never sent to the browser and
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

export const newRaterSet = (
  rater: string,
  salt: string,
  now: string,
  rubric: string = RUBRIC_VERSION,
): RaterSet => ({
  schema_version: RATER_SET_SCHEMA_VERSION,
  rubric,
  rater,
  salt,
  created: now,
});

/** The set as written to disk: two-space JSON with a final newline. */
export const renderRaterSet = (set: RaterSet): string =>
  `${JSON.stringify(set, null, 2)}\n`;

/**
 * Where a rater's set of one rated set lives, relative to the checkout. hb
 * keeps the path it had before v1h, so its salts and answer ids still hold.
 */
export const raterSetFile = (set: RatedSet, rater: string): string =>
  set === "hb"
    ? `${RATER_SETS_DIR}/${rater}.json`
    : `${RATER_SETS_DIR}/${set}/${rater}.json`;
