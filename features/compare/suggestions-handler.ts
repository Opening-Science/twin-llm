import { isToolRefusal, type ToolRefusal } from "@/packages/query-tools/refusals";
import type { SessionScope } from "@/packages/query-tools/scope";
import type {
  CoverageInput,
  CoverageResult,
  WearableCoverageResult,
  WearableReading,
} from "@/packages/query-tools/warehouse-tools";

import {
  cohortCodes,
  cohortSuggestions,
  NO_SUGGESTIONS,
  requestedSubject,
  type Suggestions,
  wearableFamilyOf,
  wearableSuggestions,
} from "./suggestions";

/**
 * `GET /api/chat/suggestions` (SERVER-SPEC 3.9). Always a JSON
 * `{ heading, questions }`, empty when there is nothing to ask or the
 * person is signed out. One coverage read per call, through the query tools,
 * which audit it and enforce the chat's scope. No model is called.
 */

export type SuggestionsDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  dataMode: () => "synthetic" | "personal";
  findSubject: (
    requested: string | null,
  ) => Promise<Readonly<{ ref: string; label: string }> | null>;
  cohortCoverage: (
    scope: SessionScope,
    input: CoverageInput,
  ) => Promise<CoverageResult | ToolRefusal>;
  /** Linked wearable key families and their readings; null when none can be read. */
  loadWearables: (actor: string) => Promise<Readonly<{
    keys: readonly string[];
    readings: (key: string) => readonly WearableReading[];
  }> | null>;
  wearableCoverage: (
    scope: SessionScope,
    input: Readonly<{ keys: readonly string[]; start: string; end: string }>,
    readings: (key: string) => readonly WearableReading[],
  ) => Promise<WearableCoverageResult>;
  today: () => string;
  logError: (message: string, name: string) => void;
}>;

const reply = (body: Suggestions, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const EARLIEST = "1900-01-01";

const synthetic = async (
  deps: SuggestionsDeps,
  scope: SessionScope,
  requested: string | null,
): Promise<Suggestions> => {
  const subject = await deps.findSubject(requested);
  if (subject === null) return NO_SUGGESTIONS;
  const coverage = await deps.cohortCoverage(scope, {
    subject_ref: subject.ref,
    loinc: cohortCodes(),
    start: EARLIEST,
    end: deps.today(),
  });
  return isToolRefusal(coverage)
    ? NO_SUGGESTIONS
    : cohortSuggestions(subject, coverage.codes);
};

const personal = async (
  deps: SuggestionsDeps,
  scope: SessionScope,
): Promise<Suggestions> => {
  const linked = await deps.loadWearables(scope.actor);
  if (linked === null) return NO_SUGGESTIONS;
  const keys = [...new Set(linked.keys)].filter((key) => wearableFamilyOf(key) !== null);
  const days = keys
    .flatMap((key) => linked.readings(key).map((reading) => reading.at.slice(0, 10)))
    .sort();
  const first = days[0];
  const last = days.at(-1);
  if (keys.length === 0 || first === undefined || last === undefined)
    return NO_SUGGESTIONS;
  const coverage = await deps.wearableCoverage(
    scope,
    { keys, start: first, end: last },
    linked.readings,
  );
  return wearableSuggestions(coverage.measures);
};

export const createSuggestionsHandler =
  (deps: SuggestionsDeps) =>
  async (request: Request): Promise<Response> => {
    try {
      const actor = await deps.resolveActorId();
      if (actor === null) return reply(NO_SUGGESTIONS);
      const scope: SessionScope = { actor, sessionId: actor, mode: deps.dataMode() };
      return reply(
        scope.mode === "synthetic"
          ? await synthetic(
              deps,
              scope,
              requestedSubject(new URL(request.url).searchParams.get("subject")),
            )
          : await personal(deps, scope),
      );
    } catch (error) {
      deps.logError(
        "[suggestions] could not build",
        error instanceof Error ? error.name : "unknown",
      );
      return reply(NO_SUGGESTIONS, 502);
    }
  };
