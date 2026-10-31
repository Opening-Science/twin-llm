import { z } from "zod";

import { isRubricLevel, RUBRIC_VERSION } from "./rater-rubric";

/**
 * One rater's ratings of one evaluation run, as the rating view writes them
 * to `evaluation/runs/<run>/ratings/<rater>.json` (#351; format in
 * `docs/evaluation/second-rater.md`). Pure: the loader reads and writes the
 * file, this module parses it and makes the next version of it.
 */

export const RATINGS_SCHEMA_VERSION = "twin-llm.eval.ratings.v1";

/** Where a run's rating files live, relative to the run folder. */
export const RATINGS_DIR = "ratings";

const ratingSchema = z
  .object({
    item_id: z.string().min(1),
    repeat: z.number().int().positive(),
    level: z.number().refine(isRubricLevel, "level must be a whole number from 1 to 5"),
    comment: z.string().max(2000),
    rated_at: z.string(),
  })
  .strict();

export type LineRating = z.infer<typeof ratingSchema>;

export const ratingFileSchema = z
  .object({
    schema_version: z.literal(RATINGS_SCHEMA_VERSION),
    rubric: z.string(),
    run_id: z.string().min(1),
    rater: z.string().min(1),
    order_seed: z.string(),
    updated: z.string(),
    ratings: z.array(ratingSchema),
  })
  .strict();

export type RatingFile = z.infer<typeof ratingFileSchema>;

/** The file's ratings, or null when it is not a ratings file of this version. */
export const parseRatingFile = (text: string): RatingFile | null => {
  try {
    const parsed = ratingFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const emptyRatingFile = (
  runId: string,
  rater: string,
  orderSeed: string,
  now: string,
): RatingFile => ({
  schema_version: RATINGS_SCHEMA_VERSION,
  rubric: RUBRIC_VERSION,
  run_id: runId,
  rater,
  order_seed: orderSeed,
  updated: now,
  ratings: [],
});

const byLine = (a: LineRating, b: LineRating): number =>
  a.item_id.localeCompare(b.item_id) || a.repeat - b.repeat;

/**
 * The file with this line's rating set (replacing an earlier one), or with
 * it removed when `level` is null. Ratings stay sorted by item and repeat so
 * the file diffs cleanly.
 */
export const withRating = (
  file: RatingFile,
  line: Readonly<{ itemId: string; repeat: number }>,
  level: number | null,
  comment: string,
  now: string,
): RatingFile => {
  const others = file.ratings.filter(
    (rating) => !(rating.item_id === line.itemId && rating.repeat === line.repeat),
  );
  const next =
    level === null
      ? others
      : [
          ...others,
          {
            item_id: line.itemId,
            repeat: line.repeat,
            level,
            comment: comment.trim(),
            rated_at: now,
          },
        ];
  return { ...file, updated: now, ratings: [...next].sort(byLine) };
};

/** `item_id#repeat`, the key a run's lines and ratings are matched on. */
export const lineKey = (itemId: string, repeat: number): string => `${itemId}#${repeat}`;

export const ratingsByLine = (file: RatingFile): ReadonlyMap<string, LineRating> =>
  new Map(file.ratings.map((rating) => [lineKey(rating.item_id, rating.repeat), rating]));

/** The file as written to disk: two-space JSON with a final newline. */
export const renderRatingFile = (file: RatingFile): string =>
  `${JSON.stringify(file, null, 2)}\n`;

export const RATINGS_EXPORT_SCHEMA_VERSION = "twin-llm.eval.ratings-export.v1";

export type RatingsExport = Readonly<{
  schema_version: typeof RATINGS_EXPORT_SCHEMA_VERSION;
  rater: string;
  rubric: string;
  files: readonly RatingFile[];
}>;

/** All of one rater's files in one document, for handing to whoever computes agreement. */
export const ratingsExport = (
  rater: string,
  files: readonly RatingFile[],
): RatingsExport => ({
  schema_version: RATINGS_EXPORT_SCHEMA_VERSION,
  rater,
  rubric: RUBRIC_VERSION,
  files: [...files].sort((a, b) => a.run_id.localeCompare(b.run_id)),
});
