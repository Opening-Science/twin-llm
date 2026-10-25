import { classifyCompletion } from "@/infrastructure/classify-completion";
import {
  matchOfferedMetric,
  type OfferedMetric,
  offeredMetrics,
  type WearableSummaries,
} from "@/infrastructure/offered-keys";
import type { EvidenceAttribution, OuraSummary } from "@/infrastructure/oura-types";
import { sectionLines } from "@/infrastructure/twin-section-lines";

export type { EvidenceAttribution } from "@/infrastructure/oura-types";
export type { WearableSummaries } from "@/infrastructure/offered-keys";

export type ParsedTwinAnswer = Readonly<{
  reasoningText: string | null;
  answerText: string;
  uncertaintyText: string | null;
  /** Keys the model claimed to use (may include "none"). */
  citedKeys: readonly string[];
  /** Cited keys that match a key the prompt listed, as the model wrote them. */
  evidenceKeys: readonly string[];
  /** Cited keys the prompt never listed (invented, over the cap, or filtered). */
  hallucinatedKeys: readonly string[];
  attribution: readonly EvidenceAttribution[];
  /** The reply opened with `REFUSE`: the model declined a dose, medicine or diagnosis request. */
  declined: boolean;
  /** How many wearable keys the prompt listed for these summaries. */
  offeredKeyCount: number;
}>;

export type TwinSection = "reasoning" | "evidence" | "answer" | "uncertainty";

/**
 * Heading labels a reply may use for each section, lower case. The system
 * prompt asks for the exact four, but small local models rename them
 * (`Summary`, `Limitations`), so the parser accepts the common aliases.
 */
const SECTION_ALIASES: Readonly<Record<string, TwinSection>> = {
  reasoning: "reasoning",
  "evidence used": "evidence",
  evidence: "evidence",
  answer: "answer",
  summary: "answer",
  "final answer": "answer",
  response: "answer",
  uncertainty: "uncertainty",
  limitations: "uncertainty",
};

type HeadingLine = Readonly<{
  /** Offset of the heading line. */
  start: number;
  /** Offset where the section body starts: after the heading line, or after an inline label. */
  bodyStart: number;
  /** The section this heading names, canonical or alias; null for any other heading. */
  section: TwinSection | null;
  canonical: boolean;
}>;

const sectionOfLabel = (label: string): TwinSection | null =>
  SECTION_ALIASES[label.replace(/:$/, "").trim().replace(/\s+/g, " ").toLowerCase()] ??
  null;

/**
 * Heading lines (`## Answer`, `**Summary**`), or inline labels (`Answer: …`)
 * when the reply has no heading line at all; see `sectionLines`.
 */
const headingLines = (text: string): HeadingLine[] =>
  sectionLines(text).map((line) =>
    line.kind === "heading"
      ? {
          start: line.start,
          bodyStart: Math.min(line.end + 1, text.length),
          section: sectionOfLabel(line.label),
          canonical: line.canonical !== null,
        }
      : {
          start: line.start,
          bodyStart: line.bodyStart,
          section: SECTION_ALIASES[line.heading.toLowerCase()] ?? null,
          canonical: false,
        },
  );

export type SectionSpan = Readonly<{
  start: number;
  bodyStart: number;
  end: number;
  canonical: boolean;
}>;

export type SectionSpans = Readonly<Partial<Record<TwinSection, SectionSpan>>>;

const SECTIONS: readonly TwinSection[] = [
  "reasoning",
  "evidence",
  "answer",
  "uncertainty",
];

/**
 * Where each section starts and ends.
 *
 * Start: the first canonical heading (`## Answer`) wins. An alias, `###` or
 * bold heading (`**Summary**`, `### Limitations`) only starts a section that
 * has no canonical heading, so a bold label inside the reasoning cannot steal
 * the answer. Inline labels (`Answer: …`) only exist in a reply with no
 * heading line at all and at least two labels (`sectionLines`).
 *
 * End: Reasoning, Evidence Used and Uncertainty end at the next heading line
 * of any kind, so a `## Notes` after the evidence cites nothing. The Answer
 * ends only at the next section start; other headings inside it are content.
 */
export const sectionSpans = (text: string): SectionSpans => {
  const lines = headingLines(text);
  const starts = SECTIONS.flatMap((section) => {
    const line =
      lines.find((candidate) => candidate.canonical && candidate.section === section) ??
      lines.find((candidate) => candidate.section === section);
    return line ? [{ section, line }] : [];
  });

  return Object.fromEntries(
    starts.map(({ section, line }) => {
      const boundaries = section === "answer" ? starts.map((other) => other.line) : lines;
      const end =
        boundaries
          .map((boundary) => boundary.start)
          .filter((offset) => offset > line.start)
          .sort((a, b) => a - b)[0] ?? text.length;
      return [
        section,
        { start: line.start, bodyStart: line.bodyStart, end, canonical: line.canonical },
      ];
    }),
  );
};

/** The section's text, trimmed; null when absent or empty. */
export const sectionText = (
  spans: SectionSpans,
  text: string,
  section: TwinSection,
): string | null => {
  const span = spans[section];
  return span ? text.slice(span.bodyStart, span.end).trim() || null : null;
};

/** True when the text holds at least one of the four canonical headings. */
export const hasCanonicalHeading = (text: string): boolean =>
  headingLines(text).some((line) => line.canonical);

/** A bare token that reads as a key: dotted, at least two segments. */
const KEY_LIKE = /^[a-z0-9_-]{2,}(?:\.[a-z0-9_-]+)+$/i;

/**
 * Pull citation keys from an Evidence Used block. Models rarely follow one
 * format, so we accept `[key]` anywhere on a line, and a bullet whose first
 * token is `none` or key-like (`- key`). Other bullet words are prose, not
 * citations: `- Sleep score was 80` cites nothing, and is left to the label
 * fallback in `resolveAttribution`.
 */
const parseCitedKeys = (evidenceSection: string | null): string[] => {
  if (!evidenceSection) return [];
  const keys: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const key = raw.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key.toLowerCase() === "none" ? "none" : key);
  };

  for (const line of evidenceSection.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    for (const match of trimmed.matchAll(/\[([a-z0-9_.-]+)\]/gi)) {
      push(match[1]);
    }

    if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
      const firstToken = trimmed
        .replace(/^[-*]\s*/, "")
        .split(/\s+/)[0]
        ?.replace(/[:,;.)]+$/, "");
      if (!firstToken || firstToken.startsWith("[")) continue;
      if (firstToken.toLowerCase() === "none" || KEY_LIKE.test(firstToken)) {
        push(firstToken);
      }
    }
  }

  return keys;
};

const normalizeLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Attaches cited keys to metrics the prompt offered, never to the rest of the
 * snapshot. The label fallback stays for models that write the label instead
 * of the key; it only runs when no key matched and only over offered metrics.
 */
export const resolveAttribution = (
  keys: readonly string[],
  offered: readonly OfferedMetric[],
  evidenceSection: string | null,
): EvidenceAttribution[] => {
  if (offered.length === 0) return [];

  const out: EvidenceAttribution[] = [];
  const used = new Set<string>();

  const add = (metric: OfferedMetric) => {
    if (used.has(metric.key)) return;
    used.add(metric.key);
    out.push({
      metricKey: metric.key,
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
    });
  };

  for (const key of keys) {
    if (key === "none") continue;
    const match = matchOfferedMetric(key, offered);
    if (match) add(match);
  }

  if (out.length === 0 && evidenceSection) {
    const blob = normalizeLabel(evidenceSection);
    for (const metric of offered) {
      const label = normalizeLabel(metric.label);
      if (label.length >= 6 && blob.includes(label)) add(metric);
    }
  }

  return out;
};

export const citedKeysForDataBasis = (citedKeys: readonly string[]): string[] =>
  citedKeys.filter((key) => key !== "none");

export const hasSufficientCitedKeys = (citedKeys: readonly string[]): boolean =>
  citedKeysForDataBasis(citedKeys).length > 0;

const normalizeSummaries = (
  input: WearableSummaries | OuraSummary | null | undefined,
): WearableSummaries => {
  if (input == null)
    return { oura: null, whoop: null, googleHealth: null, vitronic: null };
  if (
    typeof input === "object" &&
    ("oura" in input ||
      "whoop" in input ||
      "googleHealth" in input ||
      "vitronic" in input)
  ) {
    const summaries = input as WearableSummaries;
    return {
      oura: summaries.oura ?? null,
      whoop: summaries.whoop ?? null,
      googleHealth: summaries.googleHealth ?? null,
      vitronic: summaries.vitronic ?? null,
    };
  }
  return { oura: input as OuraSummary, whoop: null, googleHealth: null, vitronic: null };
};

/**
 * Splits a Twin LLM structured reply into CoT, answer body, and attributions.
 * Citations are checked against `offeredMetrics` of the snapshots passed in,
 * the same keys the system prompt listed, whichever caller passes them.
 */
export const parseTwinAnswer = (
  text: string,
  summaries: WearableSummaries | OuraSummary | null | undefined,
): ParsedTwinAnswer => {
  const offered = offeredMetrics(normalizeSummaries(summaries));
  const spans = sectionSpans(text);
  const reasoningText = sectionText(spans, text, "reasoning");
  const evidenceSection = sectionText(spans, text, "evidence");
  const answerSection = sectionText(spans, text, "answer");
  const uncertaintyText = sectionText(spans, text, "uncertainty");
  const citedKeys = parseCitedKeys(evidenceSection);
  const realKeys = citedKeysForDataBasis(citedKeys);

  return {
    reasoningText,
    answerText: answerSection ?? text,
    uncertaintyText,
    citedKeys,
    evidenceKeys: realKeys.filter((key) => matchOfferedMetric(key, offered) !== null),
    hallucinatedKeys: realKeys.filter((key) => matchOfferedMetric(key, offered) === null),
    attribution: resolveAttribution(citedKeys, offered, evidenceSection),
    declined: classifyCompletion(text) === "REFUSE",
    offeredKeyCount: offered.length,
  };
};
