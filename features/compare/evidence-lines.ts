import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ONLY_BANNER,
  hallucinatedKeysLine,
  INTERPRETATION_UNAVAILABLE,
  NEXT_STEP_LINES,
  toolCallCountLine,
  UNCERTAINTY_REASON_LINES,
  uncertaintyLevelLine,
} from "@/infrastructure/response-document/copy";
import {
  type ContractStateRow,
  formatContractStateLine,
} from "@/infrastructure/response-document/contract-lines";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import {
  formatGbdRow,
  gbdAttributionFor,
} from "@/infrastructure/response-document/gbd-labels";
import { uiContextLines } from "@/infrastructure/ui-context";
import { citedValueLine, citedValueText } from "@/infrastructure/wearable-provenance";

/**
 * What the reasoning and evidence panel says (SPEC 6), as data. Pure.
 * Internal codes (answer class, reasons, next step) only ever become their
 * plain sentences, and stored metric keys never appear.
 */

type Document = ResponseDocumentV1;

const isDeclined = (document: Document | null): boolean =>
  document?.answer_class === "declined_decision_support";

/** At most one banner per kind, in order: declined, abstained, guideline only. */
export const panelBanners = (document: Document | null): string[] => {
  if (document === null) return [];
  const declined = isDeclined(document);
  return [
    ...(declined ? [DECLINED_BANNER] : []),
    ...(!declined && document.abstained ? [ABSTAIN_BANNER] : []),
    ...(!declined &&
    !document.sufficient_data &&
    document.data_basis.sources.guidelines.length > 0
      ? [GUIDELINE_ONLY_BANNER]
      : []),
  ];
};

/**
 * Open with a document, unless it abstained; open for a declined answer,
 * which names who to ask instead; folded without a document.
 */
export const panelStartsOpen = (document: Document | null): boolean =>
  document !== null && (isDeclined(document) || !document.abstained);

/** One cited value, as its chip reads. */
export type EvidenceChip = Readonly<{
  heading: string;
  value: string;
  line: string | null;
  /** The answer's number does not match the reading; the words say so too. */
  mismatch: boolean;
}>;

export const evidenceChips = (
  attribution: readonly EvidenceAttribution[],
): EvidenceChip[] =>
  attribution.map((item) => {
    const { heading, value } = citedValueText(item);
    return {
      heading,
      value,
      line: citedValueLine(item),
      mismatch: item.valueCheck?.status === "not_matched",
    };
  });

export type PanelContent = Readonly<{
  reasoning: string | null;
  chips: readonly EvidenceChip[];
  /** Said when there are no chips: how many values were cited, or that none were. */
  evidenceLine: string | null;
  hallucinatedLine: string | null;
  guidelines: readonly string[];
  knowledge: readonly string[];
  literature: readonly string[];
  gbd: readonly string[];
  gbdAttribution: string | null;
  uncertaintyLevel: string | null;
  uncertaintyReasons: readonly string[];
  uncertaintyStatement: string | null;
  nextStep: string | null;
  unrenderable: string | null;
  toolCalls: string | null;
  uiContext: readonly string[];
  contractLines: readonly string[];
}>;

const unique = (lines: readonly string[]): string[] => [...new Set(lines)];

const citedCountLine = (count: number): string =>
  count === 1
    ? "1 value was cited; the thread export lists it."
    : `${String(count)} values were cited; the thread export lists them.`;

export const NO_METRICS_LINE = "No wearable metrics were cited.";

/** Everything the open panel shows, in its order. */
export const panelContent = (
  input: Readonly<{
    reasoning: string | null | undefined;
    attribution: readonly EvidenceAttribution[];
    document: Document | null;
    withheld: boolean;
    contractStates?: readonly ContractStateRow[];
  }>,
): PanelContent => {
  const { document } = input;
  const chips = evidenceChips(input.attribution);
  const citedKeys = document?.data_basis.evidence_keys.length ?? 0;
  const hallucinated = document?.data_basis.hallucinated_keys.length ?? 0;
  const sources = document?.data_basis.sources;
  const gbdRows = document?.data_basis.gbd_rows ?? [];
  const level = document?.uncertainty.level ?? "unknown";
  const reasoning = input.reasoning?.trim() ?? "";
  return {
    reasoning: input.withheld || reasoning === "" ? null : reasoning,
    chips,
    evidenceLine:
      chips.length > 0
        ? null
        : citedKeys > 0
          ? citedCountLine(citedKeys)
          : NO_METRICS_LINE,
    hallucinatedLine: hallucinated > 0 ? hallucinatedKeysLine(hallucinated) : null,
    guidelines: unique(
      (sources?.guidelines ?? []).map(
        (source) =>
          `${source.title} · ${String(source.year)} · ${source.doi === "" ? source.url : source.doi}`,
      ),
    ),
    knowledge: unique(
      (sources?.knowledge ?? []).map(
        (source) => `${source.title} · ${source.sectionHeading} · ${source.file}`,
      ),
    ),
    literature: [
      ...new Map(
        (sources?.literature ?? []).map(
          (source) =>
            [
              source.pmcid,
              `${source.title} · ${source.pmcid} · ${source.licenceLabel}`,
            ] as const,
        ),
      ).values(),
    ],
    gbd: gbdRows.map(formatGbdRow),
    gbdAttribution: gbdRows.length > 0 ? gbdAttributionFor(gbdRows) : null,
    uncertaintyLevel: level === "unknown" ? null : uncertaintyLevelLine(level),
    uncertaintyReasons: (document?.uncertainty.reasons ?? []).map(
      (reason) => UNCERTAINTY_REASON_LINES[reason],
    ),
    uncertaintyStatement:
      document === null || document.abstained || input.withheld
        ? null
        : (document.uncertainty.model_statement?.trim() ?? null) || null,
    nextStep: document === null ? null : NEXT_STEP_LINES[document.next_step],
    unrenderable:
      document?.interpretation.kind === "unrenderable"
        ? INTERPRETATION_UNAVAILABLE
        : null,
    toolCalls:
      document === null ? null : toolCallCountLine(document.data_basis.tool_calls.length),
    uiContext:
      document?.ui_context === undefined
        ? []
        : uiContextLines(document.ui_context).map((line) => line.replace(/^-\s*/, "")),
    contractLines: (input.contractStates ?? []).map(formatContractStateLine),
  };
};

/** The panel exists only when there is something in it. */
export const hasPanel = (
  input: Readonly<{
    reasoning: string | null | undefined;
    attribution: readonly EvidenceAttribution[];
    document: Document | null;
  }>,
): boolean =>
  (input.reasoning?.trim() ?? "") !== "" ||
  input.attribution.length > 0 ||
  input.document !== null;
