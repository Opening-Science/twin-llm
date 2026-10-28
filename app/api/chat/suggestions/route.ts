import { createSuggestionsHandler } from "@/features/arena/suggestions-handler";
import { wearableReadings } from "@/features/chat/show-view-tool";
import { personLabel } from "@/features/digital-twin/biomarkers/cohort-handler";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { utcDay } from "@/infrastructure/day-key";
import { serverEnv } from "@/infrastructure/env";
import { keyFamily } from "@/infrastructure/prompt-key-selection";
import { DEMO_SUBJECT_WHERE } from "@/packages/query-tools/synthetic-display";
import { runCoverage, runWearableCoverage } from "@/packages/query-tools/tools";

/**
 * Suggested first questions for an empty chat. The synthetic subject is the
 * Demo's first person in subject_ref order, as the Body twin numbers them;
 * the coverage read itself runs under the chat's scope and audit. A subject
 * page's "Ask about this subject" asks for its own subject instead; the scope
 * check in the coverage read decides whether it may be read.
 */
export const GET = createSuggestionsHandler({
  resolveActorId,
  dataMode: () => serverEnv().DATA_MODE,
  findSubject: async (requested) => {
    if (requested !== null) {
      return { ref: requested, label: `Subject ${requested.slice(0, 6)}` };
    }
    const first = await database().subject.findFirst({
      where: DEMO_SUBJECT_WHERE,
      select: { subjectRef: true },
      orderBy: { subjectRef: "asc" },
    });
    return first ? { ref: first.subjectRef, label: personLabel(0) } : null;
  },
  cohortCoverage: (scope, input) => runCoverage(scope, input),
  loadWearables: async (actor) => {
    const appUserId = await findAppUserId(actor);
    if (!appUserId) return null;
    const [oura, whoop, googleHealth] = await Promise.all([
      getLatestOuraSummary(appUserId),
      getLatestWhoopSummary(appUserId),
      getLatestGoogleHealthSummary(appUserId),
    ]);
    const summaries = { oura, whoop, googleHealth, vitronic: null };
    const keys = [
      ...(oura?.metrics ?? []),
      ...(whoop?.metrics ?? []),
      ...(googleHealth?.metrics ?? []),
    ].map((metric) => keyFamily(metric.key));
    return { keys, readings: wearableReadings(summaries) };
  },
  wearableCoverage: (scope, input, readings) =>
    runWearableCoverage(scope, input, readings),
  today: () => utcDay(new Date()),
  logError: console.error,
});
