import type { SessionScope } from "@/packages/query-tools/scope";
import type { ToolRefusal } from "@/packages/query-tools/refusals";
import type {
  CoverageResult,
  WearableCoverageResult,
  WearableReading,
} from "@/packages/query-tools/tools";

import {
  COHORT_SUGGESTION_LOINCS,
  cohortSuggestions,
  type SuggestedQuestions,
  wearableSuggestionKeys,
  wearableSuggestions,
} from "./suggested-questions";

/**
 * GET /api/chat/suggestions, as a factory so tests pass fakes.
 *
 * Synthetic mode asks about the Demo's first synthetic person (the one the
 * Body twin lists as "Synthetic person 1"), read with the `coverage` query
 * tool under the chat's own scope. Personal mode asks about the linked
 * wearables, read with `wearable_coverage` from the person's snapshot. Both
 * reads are audited by the tool, like any chat tool call, with the actor as
 * session. Nothing goes to a model.
 */

export type SuggestionDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  dataMode: () => SessionScope["mode"];
  /** The synthetic subject the questions are about, or null with no cohort loaded. */
  findSubject: () => Promise<Readonly<{ ref: string; label: string }> | null>;
  cohortCoverage: (
    scope: SessionScope,
    input: Readonly<{ subject_ref: string; loinc: string[]; start: string; end: string }>,
  ) => Promise<CoverageResult | ToolRefusal>;
  /** The person's wearable keys and their readings, or null with nothing linked. */
  loadWearables: (actor: string) => Promise<Readonly<{
    keys: readonly string[];
    readings: (key: string) => readonly WearableReading[];
  }> | null>;
  wearableCoverage: (
    scope: SessionScope,
    input: Readonly<{ keys: readonly string[]; start: string; end: string }>,
    readings: (key: string) => readonly WearableReading[],
  ) => Promise<WearableCoverageResult>;
  /** Today as YYYY-MM-DD (UTC), the end of a synthetic subject's window. */
  today: () => string;
  logError: (message: string, errorName: string) => void;
}>;

/** Synthea records start in the subject's birth year; this reaches before any. */
export const COHORT_WINDOW_START = "1900-01-01";

const NONE: SuggestedQuestions = { heading: "", questions: [] };
const NO_STORE = { "Cache-Control": "no-store" };

const synthetic = async (
  deps: SuggestionDeps,
  scope: SessionScope,
): Promise<SuggestedQuestions> => {
  const subject = await deps.findSubject();
  if (subject === null) return NONE;
  const result = await deps.cohortCoverage(scope, {
    subject_ref: subject.ref,
    loinc: [...COHORT_SUGGESTION_LOINCS],
    start: COHORT_WINDOW_START,
    end: deps.today(),
  });
  // A refusal (over the row cap, mixed units) is already audited; no chips.
  return "codes" in result ? cohortSuggestions(subject, result) : NONE;
};

const personal = async (
  deps: SuggestionDeps,
  scope: SessionScope,
): Promise<SuggestedQuestions> => {
  const wearables = await deps.loadWearables(scope.actor);
  if (wearables === null) return NONE;
  const keys = wearableSuggestionKeys(wearables.keys);
  const days = keys
    .flatMap((key) => wearables.readings(key).map((reading) => reading.at.slice(0, 10)))
    .sort();
  const start = days.at(0);
  const end = days.at(-1);
  if (start === undefined || end === undefined) return NONE;
  const result = await deps.wearableCoverage(
    scope,
    { keys, start, end },
    wearables.readings,
  );
  return wearableSuggestions(result);
};

export const createSuggestionsHandler = (deps: SuggestionDeps) => async () => {
  const actor = await deps.resolveActorId();
  if (!actor) return Response.json(NONE, { headers: NO_STORE });
  const scope: SessionScope = { actor, sessionId: actor, mode: deps.dataMode() };
  try {
    const result =
      scope.mode === "synthetic"
        ? await synthetic(deps, scope)
        : await personal(deps, scope);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    deps.logError(
      "[chat] suggested questions failed",
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json(NONE, { status: 502, headers: NO_STORE });
  }
};
