import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import { selectPromptMetrics } from "@/infrastructure/prompt-key-selection";
import { toChatVitronicSummary } from "@/packages/vitronic/summary";

/**
 * The wearable metrics the Twin system prompt actually lists, per source.
 *
 * The prompt builder and the answer parser both read this, so the keys the
 * model is shown and the keys a citation is checked against cannot drift. It
 * lives in infrastructure (not features/chat) because the arena re-parses
 * answers on the client, and features may not import each other.
 */
export type WearableSummaries = Readonly<{
  oura: OuraSummary | null;
  whoop: WhoopSummary | null;
  googleHealth: GoogleHealthSummary | null;
  vitronic: VitronicSummary | null;
}>;

export type OfferedMetric =
  | OuraSummary["metrics"][number]
  | WhoopSummary["metrics"][number]
  | GoogleHealthSummary["metrics"][number]
  | VitronicSummary["metrics"][number];

export const OFFERED_KEYS_PER_SOURCE = 40;

/** Over budget, keys are picked by category, not first-N; see `selectPromptMetrics`. */
const capped = <
  S extends { readonly metrics: readonly Readonly<{ key: string; date?: string }>[] },
>(
  summary: S | null,
): S | null =>
  summary === null
    ? null
    : {
        ...summary,
        metrics: selectPromptMetrics(summary.metrics, OFFERED_KEYS_PER_SOURCE),
      };

/** BodyLoop goes through the chat filter first, then every source is capped. */
export const offeredSummaries = (summaries: WearableSummaries): WearableSummaries => ({
  oura: capped(summaries.oura),
  whoop: capped(summaries.whoop),
  googleHealth: capped(summaries.googleHealth),
  vitronic: capped(summaries.vitronic ? toChatVitronicSummary(summaries.vitronic) : null),
});

export const offeredMetrics = (
  summaries: WearableSummaries,
): readonly OfferedMetric[] => {
  const offered = offeredSummaries(summaries);
  return [
    ...(offered.oura?.metrics ?? []),
    ...(offered.whoop?.metrics ?? []),
    ...(offered.googleHealth?.metrics ?? []),
    ...(offered.vitronic?.metrics ?? []),
  ];
};

export const offeredKeys = (summaries: WearableSummaries): readonly string[] =>
  offeredMetrics(summaries).map((metric) => metric.key);

const segments = (key: string): readonly string[] => key.toLowerCase().split(".");

/**
 * `a.b` ↔ `a.b.c` on whole segments, exactly one segment apart (a dropped or
 * added date), and the shorter side has two segments. So `oura.sleep` does not
 * stand in for `oura.sleep.score.2026-01-01`.
 */
const isDottedPrefix = (shorter: readonly string[], longer: readonly string[]): boolean =>
  shorter.length >= 2 &&
  longer.length === shorter.length + 1 &&
  shorter.every((part, index) => part === longer[index]);

/**
 * Exact, then case-insensitive exact, then dotted prefix. No substring match:
 * a short cite like `hr` must not attach to `sleep.heart_rate.*`.
 */
export const matchOfferedMetric = <M extends { readonly key: string }>(
  key: string,
  metrics: readonly M[],
): M | null => {
  const exact = metrics.find((metric) => metric.key === key);
  if (exact) return exact;
  const lower = key.toLowerCase();
  const caseInsensitive = metrics.find((metric) => metric.key.toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive;
  const cited = segments(key);
  return (
    metrics.find((metric) => {
      const offered = segments(metric.key);
      return isDottedPrefix(cited, offered) || isDottedPrefix(offered, cited);
    }) ?? null
  );
};
