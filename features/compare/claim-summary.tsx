"use client";

import { useMemo } from "react";

import {
  claimCoverage,
  claimsAgainst,
  type ReferenceSource,
  sourcesByLabel,
} from "@/infrastructure/claim-sources";

import { claimSummaryLine } from "./cite-links";

/**
 * Under a finished answer whose searches returned a guideline passage or an
 * article (#612): how many of its claims cite a returned source, are marked
 * unsupported, cite a source no search returned, or cite nothing. Nothing
 * when the turn returned no literature, so other answers are unchanged.
 */
export const ClaimSummary = ({
  text,
  sources,
}: Readonly<{ text: string; sources: readonly ReferenceSource[] }>) => {
  const line = useMemo(() => {
    if (!sources.some((source) => source.kind !== "note")) return null;
    return claimSummaryLine(claimCoverage(claimsAgainst(text, sourcesByLabel(sources))));
  }, [text, sources]);
  return line === null ? null : <p className="text-muted-foreground text-xs">{line}</p>;
};
