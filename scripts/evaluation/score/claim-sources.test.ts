import { describe, expect, test } from "bun:test";

import type { ResultLine, ToolResultLine } from "../eval-results";
import { claimFigures } from "../report";

import { scoreClaimSources } from "./claim-sources";
import { line, toolResult } from "./fixtures";
import { type AnsweredLine, isAnswered } from "./types";

/** A synthetic `guideline_search` hit, as `toGuidelineHit` returns it. */
const GUIDELINES = toolResult("guideline_search", { query: "ventilation in ALS", k: 5 }, [
  {
    id: "ean-als-2024",
    title: "EAN/ERN EURO-NMD guideline on ALS",
    year: 2024,
    society: "EAN",
    doi: "",
    url: "https://example.org/ean-als-2024",
    licence: "cc-by-nc-nd-4.0",
    ingestMode: "full_text",
    sectionHeading: "Non-invasive ventilation",
    recommendationId: null,
    recClass: null,
    evidenceLevel: null,
    page: null,
    passage: "Synthetic passage.",
  },
]);

/** A knowledge note only: TwinLLM's own notes are no literature to cite. */
const NOTES = toolResult("knowledge_search", { query: "hrv", k: 5 }, [
  {
    id: "metric-hrv",
    title: "Heart rate variability",
    file: "metrics/hrv.md",
    sectionHeading: "What it measures",
    licence: "MIT",
    passage: "Synthetic note.",
  },
]);

const answered = (answer: string, tools: readonly ToolResultLine[]): AnsweredLine => {
  const result: ResultLine = line({
    item_id: "Q-S3-01",
    scenario: "S3",
    answer,
    tool_results: [...tools],
  });
  if (!isAnswered(result)) throw new Error("fixture line must be answered");
  return result;
};

const ANSWER =
  "## Answer\nThe guideline recommends early ventilation [ean-als-2024]. Some people prefer to wait [unsupported]. Another society says the opposite [esc-pe-2019]. Most clinics follow it.";

describe("scoreClaimSources", () => {
  test("counts the claims of an answer whose turn returned a guideline", () => {
    expect(scoreClaimSources({ line: answered(ANSWER, [GUIDELINES]) })).toEqual({
      claims: 4,
      cited: 1,
      unsupported: 1,
      invented: 1,
      uncited: 1,
    });
  });

  test("is null when the turn returned no guideline or article", () => {
    expect(scoreClaimSources({ line: answered(ANSWER, [NOTES]) })).toBe(null);
    expect(scoreClaimSources({ line: answered(ANSWER, []) })).toBe(null);
  });
});

describe("claimFigures", () => {
  test("pools claims and counts answers with every claim cited or marked", () => {
    const covered = { claims: 2, cited: 1, unsupported: 1, invented: 0, uncited: 0 };
    const open = { claims: 3, cited: 1, unsupported: 0, invented: 1, uncited: 1 };
    expect(
      claimFigures({ scored: [{ claims: covered }, { claims: open }, { claims: null }] }),
    ).toEqual({
      answers: 2,
      claims: 5,
      cited: 2,
      unsupported: 1,
      invented: 1,
      uncited: 1,
      covered: 1,
    });
  });
});
