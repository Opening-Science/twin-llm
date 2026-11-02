import { generateText, type LanguageModel } from "ai";

import { isGenomeIdsBlocked } from "@/infrastructure/disclosure-ledger";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";
import {
  failedReview,
  NUMBER_REVIEWER,
  type NumberReview,
  parseReview,
  REVIEW_SYSTEM,
  reviewNumbers,
  reviewPrompt,
  reviewedAnswer,
  reviewToolText,
} from "@/infrastructure/number-review";

import { errorNameOf } from "./model-failure-log";
import type { TwinTurnToolResult } from "./run-twin-turn";

/**
 * Runs the Ultra number check (#366) on a finished answer: one call, no tools,
 * thinking left at the model's default (off on Ollama). An answer without
 * numbers asks no model. A failed or timed-out call gives a `failed` review
 * with every number unchecked; it never fails the answer. A call blocked for
 * the person's own genome identifiers (#356) carries the fixed refusal
 * sentence, which the step shows instead of a bare failure (#414).
 */

/** The check gives up after this long; the answer itself is already done. */
export const NUMBER_REVIEW_TIMEOUT_MS = 120_000;

export const runNumberReview = async (
  model: LanguageModel,
  reply: string,
  toolResults: readonly TwinTurnToolResult[],
): Promise<NumberReview> => {
  const answer = reviewedAnswer(reply);
  const { numbers, skipped } = reviewNumbers(
    answer,
    toolResults.map((result, index) => ({
      toolCallId: String(index),
      input: result.input,
      output: result.output,
    })),
  );
  if (numbers.length === 0) {
    return { reviewer: NUMBER_REVIEWER.name, status: "done", items: [], skipped };
  }
  try {
    const { text } = await generateText({
      model,
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt(answer, reviewToolText(toolResults), numbers),
      abortSignal: AbortSignal.timeout(NUMBER_REVIEW_TIMEOUT_MS),
    });
    return {
      reviewer: NUMBER_REVIEWER.name,
      status: "done",
      items: [...parseReview(text, numbers)],
      skipped,
    };
  } catch (error) {
    if (isGenomeIdsBlocked(error)) {
      console.error("[chat] number check blocked: genome identifiers");
      return failedReview(numbers, skipped, GENOME_IDS_BLOCKED_SENTENCE);
    }
    console.error("[chat] number check failed", errorNameOf(error));
    return failedReview(numbers, skipped);
  }
};
