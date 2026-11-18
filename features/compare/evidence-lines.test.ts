import { describe, expect, test } from "bun:test";

import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ONLY_BANNER,
  NEXT_STEP_LINES,
} from "@/infrastructure/response-document/copy";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import {
  hasPanel,
  NO_METRICS_LINE,
  panelBanners,
  panelContent,
  panelStartsOpen,
} from "./evidence-lines";

const DOC: ResponseDocumentV1 = {
  schema_version: "twin-llm.response.v1.1",
  intended_use: "research_hypothesis_generation_n_of_1",
  not_for_diagnostic_use: true,
  sufficient_data: true,
  abstained: false,
  answer_class: "analytics",
  data_basis: {
    evidence_keys: [],
    hallucinated_keys: [],
    tool_calls: [],
    sources: { gbd: [], guidelines: [], knowledge: [], literature: [] },
    gbd_rows: [],
  },
  uncertainty: { model_statement: "Few readings.", level: "moderate", reasons: [] },
  next_step: "none",
  interpretation: { kind: "none" },
};

const GUIDELINE = {
  tool: "guidelines",
  id: "g1",
  title: "Synthetic guideline",
  year: 2024,
  society: "Synthetic society",
  doi: "10.0000/synthetic",
  url: "https://example.org/g1",
  licence: "CC BY 4.0",
  ingestMode: "full",
  sectionHeading: null,
  recommendationId: null,
  recClass: null,
  evidenceLevel: null,
  page: null,
};

const CITED: EvidenceAttribution = {
  metricKey: "oura.daily_sleep.score",
  label: "Sleep score",
  value: 80,
  source: "oura",
  day: "2026-10-15",
};

const content = (
  document: ResponseDocumentV1 | null,
  extra: Partial<Parameters<typeof panelContent>[0]> = {},
) =>
  panelContent({
    reasoning: "Read rows.",
    attribution: [],
    document,
    withheld: false,
    ...extra,
  });

describe("the panel's banners and initial state (SPEC 6)", () => {
  test("declined replaces abstain; guideline-only needs guidelines and no sufficiency", () => {
    expect(panelBanners(null)).toEqual([]);
    expect(panelBanners(DOC)).toEqual([]);
    expect(panelBanners({ ...DOC, abstained: true })).toEqual([ABSTAIN_BANNER]);
    expect(
      panelBanners({
        ...DOC,
        abstained: true,
        answer_class: "declined_decision_support",
      }),
    ).toEqual([DECLINED_BANNER]);
    expect(
      panelBanners({
        ...DOC,
        sufficient_data: false,
        data_basis: {
          ...DOC.data_basis,
          sources: { ...DOC.data_basis.sources, guidelines: [GUIDELINE] },
        },
      }),
    ).toEqual([GUIDELINE_ONLY_BANNER]);
  });

  test("open with a document, folded when abstained or without one, open when declined", () => {
    expect(panelStartsOpen(DOC)).toBe(true);
    expect(panelStartsOpen(null)).toBe(false);
    expect(panelStartsOpen({ ...DOC, abstained: true })).toBe(false);
    expect(
      panelStartsOpen({
        ...DOC,
        abstained: true,
        answer_class: "declined_decision_support",
      }),
    ).toBe(true);
  });

  test("the panel exists only when there is something in it", () => {
    expect(hasPanel({ reasoning: " ", attribution: [], document: null })).toBe(false);
    expect(hasPanel({ reasoning: "Read.", attribution: [], document: null })).toBe(true);
    expect(hasPanel({ reasoning: null, attribution: [CITED], document: null })).toBe(
      true,
    );
    expect(hasPanel({ reasoning: null, attribution: [], document: DOC })).toBe(true);
  });
});

describe("the panel's sections (SPEC 6)", () => {
  test("chips carry the label, value and provenance, never the key", () => {
    const panel = content(DOC, { attribution: [CITED] });
    expect(panel.chips).toHaveLength(1);
    expect(panel.chips[0]?.line).toBe("From Oura, 15 Oct 2026");
    expect(panel.chips[0]?.mismatch).toBe(false);
    expect(JSON.stringify(panel)).not.toContain("oura.daily_sleep.score");
    expect(panel.evidenceLine).toBeNull();
  });

  test("a value that does not match its reading says so in words", () => {
    const panel = content(DOC, {
      attribution: [{ ...CITED, valueCheck: { status: "not_matched", stated: "75" } }],
    });
    expect(panel.chips[0]?.mismatch).toBe(true);
    expect(panel.chips[0]?.line).toContain("the answer says 75");
  });

  test("cited keys without chips are counted; neither says none were cited", () => {
    const cited = {
      ...DOC,
      data_basis: {
        ...DOC.data_basis,
        evidence_keys: ["oura.a", "oura.b"],
        hallucinated_keys: ["x.y"],
      },
    };
    const panel = content(cited);
    expect(panel.evidenceLine).toBe("2 values were cited; the thread export lists them.");
    expect(panel.hallucinatedLine).toContain("1 key");
    expect(JSON.stringify(panel)).not.toContain("oura.a");
    expect(JSON.stringify(panel)).not.toContain("x.y");
    expect(content(DOC).evidenceLine).toBe(NO_METRICS_LINE);
  });

  test("reasoning and the model's uncertainty are withheld for a withheld answer", () => {
    const panel = content({ ...DOC, abstained: true }, { withheld: true });
    expect(panel.reasoning).toBeNull();
    expect(panel.uncertaintyStatement).toBeNull();
    expect(content(DOC).reasoning).toBe("Read rows.");
    expect(content(DOC).uncertaintyStatement).toBe("Few readings.");
  });

  test("codes map to sentences; none is printed", () => {
    const panel = content({
      ...DOC,
      next_step: "consult_clinician",
      uncertainty: {
        model_statement: null,
        level: "high",
        reasons: ["tool_returned_no_rows"],
      },
      interpretation: { kind: "unrenderable", reason: "no_interpreter_input" },
    });
    expect(panel.nextStep).toBe(NEXT_STEP_LINES.consult_clinician);
    expect(panel.uncertaintyLevel).toContain("high");
    expect(panel.uncertaintyReasons).toEqual(["A data lookup returned no rows."]);
    expect(panel.unrenderable).not.toBeNull();
    const text = JSON.stringify(panel);
    for (const code of [
      "consult_clinician",
      "tool_returned_no_rows",
      "no_interpreter_input",
    ]) {
      expect(text).not.toContain(code);
    }
    expect(
      content({ ...DOC, uncertainty: { ...DOC.uncertainty, level: "unknown" } })
        .uncertaintyLevel,
    ).toBeNull();
  });

  test("sources are listed once each, literature by PMC id", () => {
    const article = {
      tool: "literature",
      id: "a1",
      title: "Synthetic article",
      journal: "J",
      year: 2025,
      pmcid: "PMC000001",
      url: "https://example.org",
      doi: "",
      licence: "cc-by",
      licenceLabel: "CC BY 4.0",
      sectionHeading: "Results",
    };
    const panel = content({
      ...DOC,
      data_basis: {
        ...DOC.data_basis,
        sources: {
          ...DOC.data_basis.sources,
          guidelines: [GUIDELINE, GUIDELINE],
          literature: [article, { ...article, id: "a2", sectionHeading: "Methods" }],
        },
      },
    });
    expect(panel.guidelines).toEqual(["Synthetic guideline · 2024 · 10.0000/synthetic"]);
    expect(panel.literature).toEqual(["Synthetic article · PMC000001 · CC BY 4.0"]);
  });

  test("the tool count, on-screen context and contract lines", () => {
    const panel = content(
      {
        ...DOC,
        ui_context: {
          panels: ["outputs"],
          organ: null,
          chart: null,
          views: [],
          viewCount: 0,
        },
      },
      { contractStates: [{ system_id: "cardio", severity: "low" }] },
    );
    expect(panel.toolCalls).toBe("0 data lookups recorded for this answer.");
    expect(panel.uiContext).toEqual(["open: outputs"]);
    expect(panel.contractLines).toEqual(["cardio low"]);
  });
});
