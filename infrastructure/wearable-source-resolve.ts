import type { WearableSummaries } from "./offered-keys";
import type { WearableSourceId } from "./wearable-provenance";
import {
  decideSources,
  decisionLine,
  heldBackNote,
  type EvidenceJudge,
  type HeldBackNote,
  type SourceDecision,
  type SourceRuleNote,
} from "./wearable-source-rules";

/**
 * The summaries a turn or a screen works from, after the source rules (#464):
 * where sources recorded the same measure on the same day, only the reading
 * used is kept and it carries the rule; a measure and day held back keeps no
 * reading, and every summary it came from carries a note saying so. The chat
 * prompt, the disclosure, the answer parser and the Digital Twin all read
 * these, so a value the app holds back can be neither offered nor cited.
 *
 * BodyLoop measures nothing the wearables do and passes through unchanged.
 */
export type ResolvedSources = Readonly<{
  summaries: WearableSummaries;
  decisions: readonly SourceDecision[];
}>;

type Summary = Readonly<{
  metrics: readonly Readonly<{ key: string; sourceRule?: SourceRuleNote }>[];
  heldBack?: readonly HeldBackNote[];
}>;

type Readings = Readonly<{
  metrics: readonly Readonly<{
    key: string;
    value: string | number;
    unit?: string;
    date?: string;
  }>[];
}>;

const tagged = (summary: Readings | null, source: WearableSourceId) =>
  (summary?.metrics ?? []).map((metric) => ({ ...metric, source }));

export const resolveWearableSources = (
  input: WearableSummaries,
  judge: EvidenceJudge,
): ResolvedSources => {
  const decisions = decideSources(
    [
      ...tagged(input.oura, "oura"),
      ...tagged(input.whoop, "whoop"),
      ...tagged(input.googleHealth, "google_health"),
    ],
    judge,
  );
  const dropped = new Set<string>();
  const rules = new Map<string, SourceRuleNote>();
  const held: HeldBackNote[] = [];
  for (const decision of decisions) {
    if (decision.kind === "only_source") continue;
    if (decision.kind === "held_back") {
      for (const reading of decision.readings) dropped.add(reading.key);
      held.push(heldBackNote(decision));
      continue;
    }
    for (const reading of decision.others) dropped.add(reading.key);
    rules.set(decision.chosen.key, {
      kind: decision.kind,
      line: decisionLine(decision) ?? "",
    });
  }
  const resolve = <S extends Summary>(
    summary: S | null,
    source: WearableSourceId,
  ): S | null => {
    if (summary === null) return null;
    const notes = held.filter((note) => note.sources.includes(source));
    return {
      ...summary,
      metrics: summary.metrics
        .filter((metric) => !dropped.has(metric.key))
        .map((metric) => {
          const rule = rules.get(metric.key);
          return rule === undefined ? metric : { ...metric, sourceRule: rule };
        }),
      ...(notes.length === 0 ? {} : { heldBack: notes }),
    };
  };
  return {
    summaries: {
      oura: resolve(input.oura, "oura"),
      whoop: resolve(input.whoop, "whoop"),
      googleHealth: resolve(input.googleHealth, "google_health"),
      vitronic: input.vitronic,
    },
    decisions,
  };
};

/** Every held-back note across the summaries, once each, newest day first. */
export const heldBackNotes = (summaries: WearableSummaries): readonly HeldBackNote[] => {
  const seen = new Map<string, HeldBackNote>();
  for (const summary of [summaries.oura, summaries.whoop, summaries.googleHealth]) {
    for (const note of summary?.heldBack ?? []) {
      seen.set(`${note.measure}|${note.day ?? ""}`, note);
    }
  }
  return [...seen.values()].sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
};
