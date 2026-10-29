import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ATTRIBUTION_LINE,
  GUIDELINE_ONLY_BANNER,
  hallucinatedKeysLine,
  INTERPRETATION_UNAVAILABLE,
  KNOWLEDGE_ATTRIBUTION_LINE,
  LITERATURE_ATTRIBUTION_LINE,
  NEXT_STEP_LINES,
  UNCERTAINTY_REASON_LINES,
  uncertaintyLevelLine,
} from "@/infrastructure/response-document/copy";
import {
  type NextStep,
  UNCERTAINTY_REASONS,
} from "@/infrastructure/response-document/document-v1";
import { GBD_ATTRIBUTION_LINE } from "@/packages/gbd-mcp/constants";

import { ExplainabilityPanel } from "./explainability-panel";
import {
  makeResponseDocument,
  syntheticGbdRow,
  syntheticGuideline,
  syntheticKnowledge,
  syntheticLiterature,
} from "./response-document-fixture";

describe("explainability panel population context", () => {
  test("renders one GBD row and the attribution sentence", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          data_basis: {
            evidence_keys: [],
            hallucinated_keys: [],
            tool_calls: [],
            sources: { gbd: [], guidelines: [] },
            gbd_rows: [syntheticGbdRow],
          },
        }),
      }),
    );
    expect(markup).toContain("Population context");
    expect(markup).toContain(
      "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages · 12.5 per 100,000 (uncertainty interval 10–15)",
    );
    expect(markup).toContain(GBD_ATTRIBUTION_LINE);
    expect(GBD_ATTRIBUTION_LINE).toBe(
      "Population estimate (IHME GBD 2021), not a statement about this person.",
    );
    expect(markup.toLowerCase()).not.toContain("risk of");
    expect(markup.toLowerCase()).not.toContain("you have");
  });
});

describe("explainability panel guideline references", () => {
  test("guideline-only shows the published-guidelines banner and the list", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          sufficient_data: false,
          next_step: "more_data",
          interpretation: { kind: "none" },
          data_basis: {
            evidence_keys: [],
            hallucinated_keys: [],
            tool_calls: [],
            sources: { gbd: [], guidelines: [syntheticGuideline] },
            gbd_rows: [],
          },
        }),
      }),
    );
    expect(markup).toContain(GUIDELINE_ONLY_BANNER);
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).toContain("Guideline references");
    expect(markup).toContain("EAN/ERN EURO-NMD ALS · 2024 · 10.1111/ene.example");
    expect(markup).toContain(GUIDELINE_ATTRIBUTION_LINE);
    expect(GUIDELINE_ONLY_BANNER).toBe(
      "Answer drawn from published guidelines only; no data about you was used.",
    );
    expect(markup.toLowerCase()).not.toContain("risk of");
    expect(markup.toLowerCase()).not.toContain("you have");
  });
});

describe("explainability panel OpenTwin knowledge", () => {
  test("a knowledge-only answer lists file and section once, with no banner", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          sufficient_data: false,
          next_step: "more_data",
          interpretation: { kind: "none" },
          data_basis: {
            evidence_keys: [],
            hallucinated_keys: [],
            tool_calls: [],
            sources: {
              gbd: [],
              guidelines: [],
              knowledge: [syntheticKnowledge, syntheticKnowledge],
            },
            gbd_rows: [],
          },
        }),
      }),
    );
    const line =
      "Metric glossary · Heart rate variability (HRV) · knowledge/opentwin/metric-glossary.md";
    expect(markup).toContain("OpenTwin knowledge");
    expect(markup.split(line).length - 1).toBe(1);
    expect(markup).toContain(KNOWLEDGE_ATTRIBUTION_LINE);
    expect(KNOWLEDGE_ATTRIBUTION_LINE).toBe(
      "OpenTwin knowledge notes, Open Science Foundation, CC BY 4.0. They describe TwinLLM itself, not this person.",
    );
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain(GUIDELINE_ONLY_BANNER);
    expect(markup).not.toContain("Guideline references");
  });

  test("a document without knowledge sources shows no knowledge section", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, { document: makeResponseDocument() }),
    );
    expect(markup).not.toContain("OpenTwin knowledge");
  });
});

describe("explainability panel literature", () => {
  test("lists each article once with its PMC id and licence, and the attribution", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          sufficient_data: false,
          next_step: "more_data",
          interpretation: { kind: "none" },
          data_basis: {
            evidence_keys: [],
            hallucinated_keys: [],
            tool_calls: [],
            sources: {
              gbd: [],
              guidelines: [],
              knowledge: [],
              literature: [syntheticLiterature, syntheticLiterature],
            },
            gbd_rows: [],
          },
        }),
      }),
    );
    const line = "Synthetic sleep article · PMC0000001 · CC BY-NC-ND";
    expect(markup).toContain(">Literature<");
    expect(markup.split(line).length - 1).toBe(1);
    expect(markup).toContain(LITERATURE_ATTRIBUTION_LINE);
    expect(LITERATURE_ATTRIBUTION_LINE).toBe(
      "Open-access articles from PubMed Central (NLM), each under its own licence. Reference material, not a statement about this person.",
    );
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain(GUIDELINE_ONLY_BANNER);
  });

  test("a document without literature shows no literature section", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, { document: makeResponseDocument() }),
    );
    expect(markup).not.toContain(">Literature<");
  });
});

describe("explainability panel internal codes", () => {
  test("unrenderable interpretation shows a plain sentence, never the reason code", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          interpretation: { kind: "unrenderable", reason: "no_interpreter_input" },
        }),
      }),
    );
    expect(markup).toContain(INTERPRETATION_UNAVAILABLE);
    expect(markup).not.toContain("no_interpreter_input");
  });
});

describe("explainability panel hallucinated keys", () => {
  const panelWith = (hallucinated: readonly string[]) =>
    renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          data_basis: {
            evidence_keys: ["oura.sleep.score.2026-01-01"],
            hallucinated_keys: [...hallucinated],
            tool_calls: [],
            sources: { gbd: [], guidelines: [] },
            gbd_rows: [],
          },
        }),
      }),
    );

  test("shows a plain count line and never the invented key strings", () => {
    const markup = panelWith(["oura.made.up.2026-01-01", "oura.also.invented"]);
    expect(markup).toContain("The model cited 2 keys that were not in its context.");
    expect(markup).not.toContain("oura.made.up.2026-01-01");
    expect(markup).not.toContain("oura.also.invented");
    expect(hallucinatedKeysLine(1)).toBe(
      "The model cited 1 key that was not in its context.",
    );
  });

  test("no line when every cited key was offered", () => {
    expect(panelWith([])).not.toContain("not in its context");
  });
});

describe("explainability panel v1.1 uncertainty", () => {
  test("level and reason sentences, never the codes", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          uncertainty: {
            model_statement: "One synthetic day is not a trend.",
            level: "moderate",
            reasons: ["tool_returned_no_rows", "no_model_statement"],
          },
        }),
      }),
    );
    expect(markup).toContain(
      "Uncertainty: moderate (based on the data behind this answer).",
    );
    expect(markup).toContain("A data lookup returned no rows.");
    expect(markup).toContain("The model wrote no uncertainty statement.");
    expect(markup).toContain("One synthetic day is not a trend.");
    expect(markup).not.toContain("tool_returned_no_rows");
    expect(markup).not.toContain("no_model_statement");
    expect(uncertaintyLevelLine("high")).toBe(
      "Uncertainty: high (based on the data behind this answer).",
    );
  });

  test("every reason code maps to one plain sentence", () => {
    expect(UNCERTAINTY_REASONS.map((reason) => UNCERTAINTY_REASON_LINES[reason])).toEqual(
      [
        "No person-level data was used.",
        "Only published guidelines support this answer.",
        "Only population figures support this answer.",
        "Only OpenTwin notes about TwinLLM itself support this answer.",
        "Only published articles support this answer.",
        "Some cited keys were not in the model's context.",
        "A data lookup returned no rows.",
        "The model wrote no uncertainty statement.",
        "The request was declined.",
      ],
    );
  });

  test("a document saved before v1.1 (level unknown) shows no rating line", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({ uncertainty: { model_statement: null } }),
      }),
    );
    expect(markup).not.toContain("Uncertainty");
    expect(markup).not.toContain("based on the data behind this answer");
  });
});

describe("explainability panel v1.1 next step", () => {
  const nextStepMarkup = (next_step: NextStep) =>
    renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({ next_step }),
      }),
    );

  test.each([
    ["more_data", "A firmer answer needs more data than this one had."],
    ["connect_wearable", "Connect and sync a wearable so answers can use your own data."],
    ["consult_clinician", "A clinician is the right person to ask about this."],
  ] as const)("%s renders one sentence", (step, sentence) => {
    const markup = nextStepMarkup(step);
    expect(markup).toContain(sentence);
    expect(markup).not.toContain(step);
  });

  test("none renders no next-step sentence", () => {
    const markup = nextStepMarkup("none");
    for (const line of Object.values(NEXT_STEP_LINES)) {
      if (line) expect(markup).not.toContain(line);
    }
    expect(NEXT_STEP_LINES.none).toBeNull();
  });
});

describe("explainability panel declined answer", () => {
  test("shows the declined banner instead of the abstain banner", () => {
    const markup = renderToStaticMarkup(
      createElement(ExplainabilityPanel, {
        document: makeResponseDocument({
          sufficient_data: false,
          abstained: true,
          answer_class: "declined_decision_support",
          uncertainty: { model_statement: null, level: "high", reasons: ["declined"] },
          next_step: "consult_clinician",
          interpretation: { kind: "none" },
        }),
      }),
    );
    expect(markup).toContain(DECLINED_BANNER);
    expect(DECLINED_BANNER).toBe(
      "Declined — this research tool does not make health decisions such as doses or medicine changes.",
    );
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain(GUIDELINE_ONLY_BANNER);
    expect(markup).toContain("Uncertainty: high (based on the data behind this answer).");
    expect(markup).toContain("The request was declined.");
    expect(markup).toContain("A clinician is the right person to ask about this.");
    expect(markup).not.toContain("declined_decision_support");
  });
});
