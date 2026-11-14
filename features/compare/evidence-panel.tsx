"use client";

import { type ReactNode, useId, useState } from "react";

import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import {
  GUIDELINE_ATTRIBUTION_LINE,
  KNOWLEDGE_ATTRIBUTION_LINE,
  KNOWLEDGE_HEADING,
  LITERATURE_ATTRIBUTION_LINE,
  LITERATURE_HEADING,
  UI_CONTEXT_HEADING,
  UI_CONTEXT_NOTE,
} from "@/infrastructure/response-document/copy";
import type { ContractStateRow } from "@/infrastructure/response-document/contract-lines";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { RichText } from "@/infrastructure/rich-text";
import { cn } from "@/infrastructure/ui";

import {
  type EvidenceChip,
  panelBanners,
  panelContent,
  panelStartsOpen,
} from "./evidence-lines";

/**
 * The reasoning and evidence under a finished answer (SPEC 6): banners, a
 * Show / Hide toggle with its expanded state, and the sections in order.
 * The chips stay visible while the panel is folded.
 */

const Section = ({
  heading,
  children,
}: Readonly<{ heading: string; children: ReactNode }>) => (
  <section className="flex flex-col gap-1.5">
    <h4 className="text-eyebrow">{heading}</h4>
    {children}
  </section>
);

const Lines = ({ lines }: Readonly<{ lines: readonly string[] }>) => (
  <ul className="flex flex-col gap-1">
    {lines.map((line) => (
      <li key={line}>{line}</li>
    ))}
  </ul>
);

const Chips = ({ chips }: Readonly<{ chips: readonly EvidenceChip[] }>) => (
  <ul className="flex flex-wrap gap-2">
    {chips.map((chip, index) => (
      <li
        key={`${chip.heading}-${String(index)}`}
        className="border-border bg-background flex max-w-full flex-col gap-0.5 rounded-md border px-2.5 py-1.5"
      >
        <span>
          <span className="text-foreground font-medium">{chip.heading}</span>{" "}
          <span className="text-muted-foreground">{chip.value}</span>
        </span>
        {chip.line === null ? null : (
          <span
            className={cn(chip.mismatch ? "text-destructive" : "text-muted-foreground")}
          >
            {chip.line}
          </span>
        )}
      </li>
    ))}
  </ul>
);

export const EvidencePanel = ({
  reasoning,
  attribution,
  document,
  withheld,
  contractStates,
}: Readonly<{
  reasoning: string | null | undefined;
  attribution: readonly EvidenceAttribution[];
  document: ResponseDocumentV1 | null;
  withheld: boolean;
  /** Interpreter contract states; no caller passes them today. */
  contractStates?: readonly ContractStateRow[];
}>) => {
  const bodyId = useId();
  const [open, setOpen] = useState(() => panelStartsOpen(document));
  const banners = panelBanners(document);
  const content = panelContent({
    reasoning,
    attribution,
    document,
    withheld,
    ...(contractStates === undefined ? {} : { contractStates }),
  });

  return (
    <div className="text-muted-foreground flex flex-col gap-2 text-xs">
      {banners.map((banner) => (
        <p key={banner}>{banner}</p>
      ))}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
        className="hover:text-foreground self-start underline-offset-2 hover:underline"
      >
        {open ? "Hide reasoning & evidence" : "Show reasoning & evidence"}
      </button>
      {!open && content.chips.length > 0 ? <Chips chips={content.chips} /> : null}
      <div id={bodyId} hidden={!open} className="flex flex-col gap-3">
        {open ? (
          <>
            {content.reasoning === null ? null : (
              <Section heading="Reasoning">
                <RichText text={content.reasoning} className="text-muted-foreground" />
              </Section>
            )}
            <Section heading="Evidence">
              {content.chips.length > 0 ? <Chips chips={content.chips} /> : null}
              {content.evidenceLine === null ? null : <p>{content.evidenceLine}</p>}
              {content.hallucinatedLine === null ? null : (
                <p>{content.hallucinatedLine}</p>
              )}
            </Section>
            {content.guidelines.length === 0 ? null : (
              <Section heading="Guideline references">
                <Lines lines={content.guidelines} />
                <p>{GUIDELINE_ATTRIBUTION_LINE}</p>
              </Section>
            )}
            {content.knowledge.length === 0 ? null : (
              <Section heading={KNOWLEDGE_HEADING}>
                <Lines lines={content.knowledge} />
                <p>{KNOWLEDGE_ATTRIBUTION_LINE}</p>
              </Section>
            )}
            {content.literature.length === 0 ? null : (
              <Section heading={LITERATURE_HEADING}>
                <Lines lines={content.literature} />
                <p>{LITERATURE_ATTRIBUTION_LINE}</p>
              </Section>
            )}
            {content.gbd.length === 0 ? null : (
              <Section heading="Population context">
                <Lines lines={content.gbd} />
                {content.gbdAttribution === null ? null : <p>{content.gbdAttribution}</p>}
              </Section>
            )}
            {content.uncertaintyLevel === null &&
            content.uncertaintyStatement === null ? null : (
              <Section heading="Uncertainty">
                {content.uncertaintyLevel === null ? null : (
                  <p>{content.uncertaintyLevel}</p>
                )}
                {content.uncertaintyReasons.length === 0 ? null : (
                  <Lines lines={content.uncertaintyReasons} />
                )}
                {content.uncertaintyStatement === null ? null : (
                  <RichText text={content.uncertaintyStatement} />
                )}
              </Section>
            )}
            {content.nextStep === null ? null : <p>{content.nextStep}</p>}
            {content.unrenderable === null ? null : <p>{content.unrenderable}</p>}
            {content.toolCalls === null ? null : <p>{content.toolCalls}</p>}
            {content.uiContext.length === 0 ? null : (
              <Section heading={UI_CONTEXT_HEADING}>
                <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
                  {content.uiContext.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p>{UI_CONTEXT_NOTE}</p>
              </Section>
            )}
            {content.contractLines.length === 0 ? null : (
              <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
                {content.contractLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
};
