"use client";

import { useState } from "react";

import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import { RichText } from "@/infrastructure/rich-text";
import {
  type ContractStateRow,
  formatContractStateLine,
} from "@/infrastructure/response-document/contract-lines";
import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ATTRIBUTION_LINE,
  GUIDELINE_ONLY_BANNER,
  hallucinatedKeysLine,
  INTERPRETATION_UNAVAILABLE,
  KNOWLEDGE_ATTRIBUTION_LINE,
  KNOWLEDGE_HEADING,
  LITERATURE_ATTRIBUTION_LINE,
  LITERATURE_HEADING,
  NEXT_STEP_LINES,
  toolCallCountLine,
  UI_CONTEXT_HEADING,
  UI_CONTEXT_NOTE,
  UNCERTAINTY_REASON_LINES,
  uncertaintyLevelLine,
} from "@/infrastructure/response-document/copy";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { uiContextLines } from "@/infrastructure/ui-context";
import { formatGbdRow } from "@/infrastructure/response-document/gbd-labels";
import { GBD_ATTRIBUTION_LINE } from "@/packages/gbd-mcp/constants";

const EvidencePanel = ({
  attribution,
  evidenceKeys,
}: {
  readonly attribution: readonly EvidenceAttribution[];
  readonly evidenceKeys: readonly string[];
}) => {
  if (attribution.length === 0 && evidenceKeys.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No wearable metrics cited for this answer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {evidenceKeys.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-0.5 font-mono text-xs">
          {evidenceKeys.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
      )}
      {attribution.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {attribution.map((item) => (
            <li
              key={item.metricKey}
              className="border-input bg-muted/40 rounded-md border px-2 py-1 text-xs"
              title={item.metricKey}
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-muted-foreground ml-1">
                {item.value}
                {item.unit ? ` ${item.unit}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * Collapsible chain-of-thought plus the response document's data basis.
 * Order inside the panel: reasoning, evidence used, guideline references,
 * OpenTwin knowledge, literature, population context, uncertainty (level, reasons, model statement), next
 * step, tool-call count (docs/response-schema.md, "UI copy"). Internal codes
 * are mapped to plain sentences, never printed.
 */
export const ExplainabilityPanel = ({
  reasoningText,
  attribution,
  document,
  contractStates,
}: {
  readonly reasoningText?: string | null;
  readonly attribution?: readonly EvidenceAttribution[] | null;
  readonly document?: ResponseDocumentV1 | null;
  readonly contractStates?: readonly ContractStateRow[];
}) => {
  const [open, setOpen] = useState(Boolean(document));
  const hasAttribution = Boolean(attribution && attribution.length > 0);
  const hasReasoning = Boolean(reasoningText && reasoningText.trim());
  const evidenceKeys = document?.data_basis.evidence_keys ?? [];
  const hallucinatedCount = document?.data_basis.hallucinated_keys.length ?? 0;
  const gbdRows = document?.data_basis.gbd_rows ?? [];
  const guidelineCites = document?.data_basis.sources.guidelines ?? [];
  // One line per file and section, even when two searches hit the same one.
  const knowledgeCites = [
    ...new Map(
      (document?.data_basis.sources.knowledge ?? []).map((cite) => [
        `${cite.file}#${cite.sectionHeading}`,
        cite,
      ]),
    ).values(),
  ];
  // One line per article, even when several of its passages were returned.
  const literatureCites = [
    ...new Map(
      (document?.data_basis.sources.literature ?? []).map((cite) => [cite.pmcid, cite]),
    ).values(),
  ];
  const toolCallCount = document?.data_basis.tool_calls.length ?? 0;
  const declined = document?.answer_class === "declined_decision_support";
  const guidelineOnly =
    !declined && document?.sufficient_data === false && guidelineCites.length > 0;
  const uncertaintyText = document?.uncertainty.model_statement;
  // Model-written text: withheld along with the answer when it abstained.
  const hasModelStatement =
    document?.abstained !== true && Boolean(uncertaintyText && uncertaintyText.trim());
  // Host-derived; a document saved before v1.1 reads `unknown` and shows no rating.
  const level = document?.uncertainty.level ?? "unknown";
  const reasons = document?.uncertainty.reasons ?? [];
  const hasUncertainty = hasModelStatement || level !== "unknown";
  const nextStepLine = document ? NEXT_STEP_LINES[document.next_step] : null;
  const hasContractStates = Boolean(contractStates && contractStates.length > 0);
  const uiLines = document?.ui_context ? uiContextLines(document.ui_context) : [];

  if (!hasReasoning && !hasAttribution && attribution === undefined && !document) {
    return null;
  }

  return (
    <div className="border-border mt-3 border-t pt-3">
      {declined && (
        <p className="text-muted-foreground mb-2 text-xs">{DECLINED_BANNER}</p>
      )}
      {!declined && document?.abstained && (
        <p className="text-muted-foreground mb-2 text-xs">{ABSTAIN_BANNER}</p>
      )}
      {guidelineOnly && (
        <p className="text-muted-foreground mb-2 text-xs">{GUIDELINE_ONLY_BANNER}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-muted-foreground hover:text-foreground text-xs font-medium"
      >
        {open ? "Hide" : "Show"} reasoning & evidence
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {hasReasoning && (
            <div>
              <p className="text-eyebrow mb-1">Reasoning</p>
              <RichText
                text={reasoningText!}
                className="text-muted-foreground text-sm leading-relaxed"
              />
            </div>
          )}
          <div>
            <p className="text-eyebrow mb-1">Evidence</p>
            <EvidencePanel attribution={attribution ?? []} evidenceKeys={evidenceKeys} />
            {hallucinatedCount > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">
                {hallucinatedKeysLine(hallucinatedCount)}
              </p>
            )}
          </div>
          {guidelineCites.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1">Guideline references</p>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {guidelineCites.map((cite) => (
                  <li key={`${cite.id}-${cite.sectionHeading ?? ""}`}>
                    {cite.title} · {cite.year} · {cite.doi || cite.url}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {GUIDELINE_ATTRIBUTION_LINE}
              </p>
            </div>
          )}
          {knowledgeCites.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1">{KNOWLEDGE_HEADING}</p>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {knowledgeCites.map((cite) => (
                  <li key={`${cite.file}#${cite.sectionHeading}`}>
                    {cite.title} · {cite.sectionHeading} · {cite.file}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {KNOWLEDGE_ATTRIBUTION_LINE}
              </p>
            </div>
          )}
          {literatureCites.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1">{LITERATURE_HEADING}</p>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {literatureCites.map((cite) => (
                  <li key={cite.pmcid}>
                    {cite.title} · {cite.pmcid} · {cite.licenceLabel}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {LITERATURE_ATTRIBUTION_LINE}
              </p>
            </div>
          )}
          {gbdRows.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1">Population context</p>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {gbdRows.map((row) => (
                  <li
                    key={`${row.measure}-${row.cause}-${row.location}-${row.year}-${row.sex}-${row.age}`}
                  >
                    {formatGbdRow(row)}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {GBD_ATTRIBUTION_LINE}
              </p>
            </div>
          )}
          {hasUncertainty && (
            <div>
              <p className="text-eyebrow mb-1">Uncertainty</p>
              {level !== "unknown" && (
                <p className="text-muted-foreground text-xs">
                  {uncertaintyLevelLine(level)}
                </p>
              )}
              {reasons.length > 0 && (
                <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs">
                  {reasons.map((reason) => (
                    <li key={reason}>{UNCERTAINTY_REASON_LINES[reason]}</li>
                  ))}
                </ul>
              )}
              {hasModelStatement && (
                <RichText
                  text={uncertaintyText!}
                  className="text-muted-foreground mt-1 text-sm leading-relaxed"
                />
              )}
            </div>
          )}
          {nextStepLine && (
            <p className="text-muted-foreground text-xs">{nextStepLine}</p>
          )}
          {document?.interpretation.kind === "unrenderable" && (
            <p className="text-muted-foreground text-xs">{INTERPRETATION_UNAVAILABLE}</p>
          )}
          {document && (
            <p className="text-muted-foreground text-xs">
              {toolCallCountLine(toolCallCount)}
            </p>
          )}
          {uiLines.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1">{UI_CONTEXT_HEADING}</p>
              <ul className="text-muted-foreground flex flex-col gap-0.5 font-mono text-xs">
                {uiLines.map((line) => (
                  <li key={line}>{line.replace(/^- /, "")}</li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {UI_CONTEXT_NOTE}
              </p>
            </div>
          )}
          {hasContractStates && (
            <ul className="text-muted-foreground flex flex-col gap-0.5 font-mono text-xs">
              {contractStates!.map((state) => (
                <li key={state.system_id}>{formatContractStateLine(state)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!open && hasAttribution && (
        <div className="mt-2">
          <EvidencePanel attribution={attribution!} evidenceKeys={[]} />
        </div>
      )}
    </div>
  );
};
