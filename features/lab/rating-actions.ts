"use server";

import { z } from "zod";

import { isAuthDisabled } from "@/infrastructure/env";

import {
  loadRaterLines,
  loadRaterSalt,
  loadRaterSession,
  loadRatingFiles,
  saveLineRating,
} from "./load-rater";
import { ratingsExport } from "./rating-file";
import { isPseudonym, isRubricLevel } from "./rater-rubric";

/**
 * Server actions of the second-rater view (#351). They write and read only
 * the ratings files beside the hb runs on this machine; nothing is sent
 * anywhere. They work on a local install only (LOCAL_MVP or AUTH_DISABLED,
 * where the server answers this machine alone), because a shared server
 * would let anyone who reaches it write into its repository folder. The
 * runs are synthetic, so the personal-data lock (#142) does not apply.
 */

export type ActionResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; message: string }>;

const NOT_LOCAL =
  "Ratings are saved on a local install only (LOCAL_MVP or AUTH_DISABLED), so they stay on this machine.";
const FAILED = "The rating could not be saved just now. Try again.";

const saveSchema = z
  .object({
    rater: z.string().refine(isPseudonym),
    token: z.string().regex(/^[0-9a-f]{16}$/),
    level: z.number().refine(isRubricLevel).nullable(),
    comment: z.string().max(2000),
  })
  .strict();

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const saveRating = async (input: unknown): Promise<ActionResult<null>> => {
  if (!isAuthDisabled()) return { ok: false, message: NOT_LOCAL };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "That rating is not one this view can save." };
  try {
    const data = await loadRaterLines(await loadRaterSalt(parsed.data.rater, true));
    const line =
      data.kind === "ready"
        ? data.lines.find((each) => each.token === parsed.data.token)
        : undefined;
    if (line === undefined) {
      return {
        ok: false,
        message: "That answer is no longer on this machine. Reload the page.",
      };
    }
    await saveLineRating(
      line,
      parsed.data.rater,
      parsed.data.level,
      parsed.data.comment,
      new Date().toISOString(),
    );
    return { ok: true, value: null };
  } catch (error) {
    console.error("[lab] rating not saved", errorName(error));
    return { ok: false, message: FAILED };
  }
};

/**
 * The rater's files as one JSON document. Offered only once every answer is
 * rated: the file names each run, and a run's name can name its model.
 */
export const exportRatings = async (rater: unknown): Promise<ActionResult<string>> => {
  if (!isAuthDisabled()) return { ok: false, message: NOT_LOCAL };
  if (typeof rater !== "string" || !isPseudonym(rater)) {
    return { ok: false, message: "That pseudonym is not one this view can use." };
  }
  try {
    const salt = await loadRaterSalt(rater, true);
    const data = await loadRaterLines(salt);
    if (data.kind !== "ready") return { ok: false, message: "No answers to export." };
    const session = await loadRaterSession(data.lines, rater, salt);
    if (session.some((line) => line.level === null)) {
      return { ok: false, message: "Export opens once every answer is rated." };
    }
    const files = await loadRatingFiles(data.lines, rater);
    return {
      ok: true,
      value: `${JSON.stringify(ratingsExport(rater, files), null, 2)}\n`,
    };
  } catch (error) {
    console.error("[lab] ratings not exported", errorName(error));
    return { ok: false, message: "The ratings could not be read just now. Try again." };
  }
};
