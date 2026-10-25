import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import {
  parseTwinAnswer,
  type WearableSummaries,
} from "@/infrastructure/parse-twin-answer";

import { buildResponseDocumentV1 } from "./build-document";
import { CHAT_RESPONSE_DOCUMENT } from "../response-document";
import {
  RESPONSE_SCHEMA_VERSION,
  type ResponseDocumentV1,
  type ResponseToolCall,
  responseDocumentV1Schema,
} from "./document-v1";
import { unrenderableInterpretation } from "./interpretation-stub";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const HASH_D = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

const WEARABLE_TEXT = [
  "## Reasoning",
  "The listed recovery scores vary by day; I only use cited keys.",
  "",
  "## Evidence Used",
  "- [whoop.recovery.score.2026-01-02]",
  "",
  "## Answer",
  "Recovery on 2026-01-02 is 64 in the injected list.",
  "",
  "## Uncertainty",
  "One day is not a trend. Missing days are not zero.",
].join("\n");

const TOOL_ONLY_TEXT = [
  "## Reasoning",
  "The warehouse row for this LOINC is the only source.",
  "",
  "## Evidence Used",
  "- none",
  "",
  "## Answer",
  "The latest 8867-4 reading for patient-2 is 72.",
  "",
  "## Uncertainty",
  "One row is not a series.",
].join("\n");

const MIXED_TEXT = [
  "## Reasoning",
  "Cite the wearable key and the warehouse tool row together.",
  "",
  "## Evidence Used",
  "- [oura.sleep.score.2026-01-01]",
  "",
  "## Answer",
  "Sleep score is 82 in the list; the warehouse window has 2 rows.",
  "",
  "## Uncertainty",
  "Two sources still cover one night.",
].join("\n");

const ABSTAIN_TEXT = [
  "## Reasoning",
  "No cited keys and no warehouse rows.",
  "",
  "## Evidence Used",
  "- none",
  "",
  "## Answer",
  "This reply is withheld.",
  "",
  "## Uncertainty",
  "No observations in the window.",
].join("\n");

const TOOL_LATEST: ResponseToolCall = {
  seq: 1,
  tool: "latest_by_loinc",
  args_sha256: HASH_A,
  result_sha256: HASH_B,
  row_count: 1,
  ts: "2026-09-27T12:00:00.000Z",
};

const TOOL_WINDOW: ResponseToolCall = {
  seq: 2,
  tool: "subject_window",
  args_sha256: HASH_C,
  result_sha256: HASH_D,
  row_count: 2,
  ts: "2026-09-27T12:00:01.000Z",
};

const emptySummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-02" };

/** Synthetic snapshot holding the keys the golden answers cite. */
const syntheticSummaries: WearableSummaries = {
  oura: {
    window: WINDOW,
    narrative: "Synthetic Oura window.",
    metrics: [{ key: "oura.sleep.score.2026-01-01", label: "Sleep score", value: 82 }],
  },
  whoop: {
    window: WINDOW,
    narrative: "Synthetic Whoop window.",
    metrics: [
      { key: "whoop.recovery.score.2026-01-02", label: "Recovery score", value: 64 },
    ],
  },
  googleHealth: null,
  vitronic: null,
};

const documentOf = (
  text: string,
  toolCalls: readonly ResponseToolCall[] = [],
  summaries: WearableSummaries = syntheticSummaries,
  mode: DataMode = "personal",
): ResponseDocumentV1 =>
  buildResponseDocumentV1({
    parsed: parseTwinAnswer(text, summaries),
    toolCalls,
    mode,
  });

const answerCiting = (keys: readonly string[]): string =>
  [
    "## Reasoning",
    "Synthetic reasoning.",
    "",
    "## Evidence Used",
    ...keys.map((key) => `- [${key}]`),
    "",
    "## Answer",
    "Synthetic answer.",
    "",
    "## Uncertainty",
    "Synthetic uncertainty.",
  ].join("\n");

describe("ResponseDocument v1.1 goldens", () => {
  test("the builder emits v1.1", () => {
    expect(RESPONSE_SCHEMA_VERSION).toBe("twin-llm.response.v1.1");
    expect(documentOf(WEARABLE_TEXT).schema_version).toBe("twin-llm.response.v1.1");
  });

  test("wearable keys only", () => {
    expect(documentOf(WEARABLE_TEXT)).toEqual({
      schema_version: RESPONSE_SCHEMA_VERSION,
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: true,
      abstained: false,
      answer_class: "analytics",
      data_basis: {
        evidence_keys: ["whoop.recovery.score.2026-01-02"],
        hallucinated_keys: [],
        tool_calls: [],
        sources: { gbd: [], guidelines: [], knowledge: [] },
        gbd_rows: [],
      },
      uncertainty: {
        model_statement: "One day is not a trend. Missing days are not zero.",
        level: "low",
        reasons: [],
      },
      next_step: "none",
      interpretation: {
        kind: "narration",
        text: "Recovery on 2026-01-02 is 64 in the injected list.",
        narration_is_unverified: true,
      },
    });
  });

  test("tool_calls only", () => {
    expect(documentOf(TOOL_ONLY_TEXT, [TOOL_LATEST])).toEqual({
      schema_version: RESPONSE_SCHEMA_VERSION,
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: true,
      abstained: false,
      answer_class: "analytics",
      data_basis: {
        evidence_keys: [],
        hallucinated_keys: [],
        tool_calls: [TOOL_LATEST],
        sources: { gbd: [], guidelines: [], knowledge: [] },
        gbd_rows: [],
      },
      uncertainty: {
        model_statement: "One row is not a series.",
        level: "low",
        reasons: [],
      },
      next_step: "none",
      interpretation: {
        kind: "narration",
        text: "The latest 8867-4 reading for patient-2 is 72.",
        narration_is_unverified: true,
      },
    });
  });

  test("mixed wearable keys and tool_calls", () => {
    expect(documentOf(MIXED_TEXT, [TOOL_LATEST, TOOL_WINDOW])).toEqual({
      schema_version: RESPONSE_SCHEMA_VERSION,
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: true,
      abstained: false,
      answer_class: "analytics",
      data_basis: {
        evidence_keys: ["oura.sleep.score.2026-01-01"],
        hallucinated_keys: [],
        tool_calls: [TOOL_LATEST, TOOL_WINDOW],
        sources: { gbd: [], guidelines: [], knowledge: [] },
        gbd_rows: [],
      },
      uncertainty: {
        model_statement: "Two sources still cover one night.",
        level: "low",
        reasons: [],
      },
      next_step: "none",
      interpretation: {
        kind: "narration",
        text: "Sleep score is 82 in the list; the warehouse window has 2 rows.",
        narration_is_unverified: true,
      },
    });
  });
});

describe("ResponseDocument v1 abstain", () => {
  test("Evidence none and no tool rows", () => {
    const document = documentOf(ABSTAIN_TEXT);
    expect(document).toEqual({
      schema_version: RESPONSE_SCHEMA_VERSION,
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: false,
      abstained: true,
      answer_class: "information",
      data_basis: {
        evidence_keys: [],
        hallucinated_keys: [],
        tool_calls: [],
        sources: { gbd: [], guidelines: [], knowledge: [] },
        gbd_rows: [],
      },
      uncertainty: {
        model_statement: "No observations in the window.",
        level: "high",
        reasons: ["no_personal_data"],
      },
      next_step: "more_data",
      interpretation: { kind: "none" },
    });
  });

  test("builder never emits kind=contract or kind=unrenderable", () => {
    const withData = documentOf(WEARABLE_TEXT);
    const withheld = documentOf(ABSTAIN_TEXT);
    expect(withData.interpretation.kind).toBe("narration");
    expect(withheld.interpretation.kind).toBe("none");
    expect(JSON.stringify(withData)).not.toContain('"contract"');
    expect(JSON.stringify(withheld)).not.toContain('"contract"');
  });
});

describe("interpretation stub", () => {
  test("unrenderable carries no_interpreter_input and the schema accepts it", () => {
    const stub = unrenderableInterpretation();
    expect(stub).toEqual({
      kind: "unrenderable",
      reason: "no_interpreter_input",
    });
    const parsed = responseDocumentV1Schema.parse({
      ...documentOf(ABSTAIN_TEXT),
      interpretation: stub,
    });
    expect(parsed.interpretation).toEqual(stub);
  });
});

describe("ResponseDocument v1 GBD fields", () => {
  test("empty sources.gbd and gbd_rows are the default", () => {
    const document = documentOf(ABSTAIN_TEXT);
    expect(document.data_basis.sources.gbd).toEqual([]);
    expect(document.data_basis.gbd_rows).toEqual([]);
  });
});

const GUIDELINE_ONLY: ResponseToolCall = {
  seq: 1,
  tool: "guidelines.guideline_search",
  args_sha256: HASH_A,
  result_sha256: HASH_B,
  row_count: 2,
  ts: "2026-09-27T12:00:00.000Z",
};

const citation = {
  tool: "guidelines.guideline_search",
  id: "ean-als-2024",
  title: "EAN/ERN EURO-NMD ALS",
  year: 2024,
  society: "EAN",
  doi: "10.1111/ene.example",
  url: "https://example.org/ean-als-2024",
  licence: "cc-by-nc-nd-4.0",
  ingestMode: "full_text",
  sectionHeading: "Non-invasive ventilation",
  recommendationId: "R3",
  recClass: "Strong",
  evidenceLevel: "moderate",
  page: "12",
};

const KNOWLEDGE_ONLY: ResponseToolCall = {
  seq: 1,
  tool: "knowledge.knowledge_search",
  args_sha256: HASH_C,
  result_sha256: HASH_D,
  row_count: 3,
  ts: "2026-10-17T12:00:00.000Z",
};

const knowledgeCitation = {
  tool: "knowledge.knowledge_search",
  id: "opentwin-metric-glossary",
  title: "Metric glossary",
  file: "knowledge/opentwin/metric-glossary.md",
  sectionHeading: "Heart rate variability (HRV)",
  licence: "cc-by-4.0",
};

const KNOWLEDGE_TEXT = [
  "## Reasoning",
  "The OpenTwin knowledge note on HRV describes the metric.",
  "",
  "## Evidence Used",
  "- none",
  "",
  "## Answer",
  "HRV is the variation in time between consecutive heartbeats, in milliseconds.",
  "",
  "## Uncertainty",
  "This describes the metric, not any person's values.",
].join("\n");

describe("ResponseDocument v1 guideline fields", () => {
  test("empty sources.guidelines is the default", () => {
    const document = documentOf(ABSTAIN_TEXT);
    expect(document.data_basis.sources.guidelines).toEqual([]);
  });

  test("guideline-only tool rows never count as sufficient_data", () => {
    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(ABSTAIN_TEXT, emptySummaries),
      toolCalls: [GUIDELINE_ONLY],
      mode: "personal",
      guidelineSources: [citation],
    });
    expect(document.sufficient_data).toBe(false);
    expect(document.abstained).toBe(false);
    expect(document.next_step).toBe("more_data");
    expect(document.interpretation).toEqual({ kind: "none" });
    expect(document.data_basis.sources.guidelines).toEqual([citation]);
    expect(JSON.stringify(document)).not.toContain("passage");
  });
});

describe("ResponseDocument v1 offered keys", () => {
  const ouraWith = (count: number): WearableSummaries => ({
    ...emptySummaries,
    oura: {
      window: WINDOW,
      narrative: "Synthetic Oura window.",
      metrics: Array.from({ length: count }, (_, index) => ({
        key: `oura.synthetic.m${index + 1}.2026-01-01`,
        label: `Synthetic metric ${index + 1}`,
        value: index + 1,
      })),
    },
  });

  test("an invented key is hallucinated and the answer abstains", () => {
    const document = documentOf(answerCiting(["oura.made.up.2026-01-01"]));
    expect(document.data_basis.evidence_keys).toEqual([]);
    expect(document.data_basis.hallucinated_keys).toEqual(["oura.made.up.2026-01-01"]);
    expect(document.sufficient_data).toBe(false);
    expect(document.abstained).toBe(true);
    expect(document.next_step).toBe("more_data");
    expect(document.interpretation).toEqual({ kind: "none" });
  });

  test("the 41st key of a source was never offered", () => {
    const document = documentOf(
      answerCiting(["oura.synthetic.m40.2026-01-01", "oura.synthetic.m41.2026-01-01"]),
      [],
      ouraWith(41),
    );
    expect(document.data_basis.evidence_keys).toEqual(["oura.synthetic.m40.2026-01-01"]);
    expect(document.data_basis.hallucinated_keys).toEqual([
      "oura.synthetic.m41.2026-01-01",
    ]);
    expect(document.sufficient_data).toBe(true);
  });

  test("a BodyLoop key removed by the chat filter is hallucinated", () => {
    const summaries: WearableSummaries = {
      ...emptySummaries,
      vitronic: {
        window: { startDate: "2026-07-10", endDate: "2026-07-10" },
        narrative: "Synthetic scan.",
        metrics: [
          {
            key: "vitronic.positions.leftHip.2026-07-10",
            label: "left hip position",
            value: 0.12,
            unit: "m",
          },
        ],
      },
    };
    const document = documentOf(
      answerCiting(["vitronic.positions.leftHip.2026-07-10"]),
      [],
      summaries,
    );
    expect(document.data_basis.evidence_keys).toEqual([]);
    expect(document.data_basis.hallucinated_keys).toEqual([
      "vitronic.positions.leftHip.2026-07-10",
    ]);
    expect(document.sufficient_data).toBe(false);
    expect(document.abstained).toBe(true);
  });

  test("a valid key plus an invented one is sufficient with one hallucinated key", () => {
    const document = documentOf(
      answerCiting(["oura.sleep.score.2026-01-01", "oura.sleep.invented.2026-01-01"]),
    );
    expect(document.data_basis.evidence_keys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(document.data_basis.hallucinated_keys).toEqual([
      "oura.sleep.invented.2026-01-01",
    ]);
    expect(document.sufficient_data).toBe(true);
    expect(document.abstained).toBe(false);
  });

  test("only hallucinated keys but a tool row: sufficient from the row, key still listed", () => {
    const document = documentOf(answerCiting(["oura.made.up.2026-01-01"]), [TOOL_LATEST]);
    expect(document.sufficient_data).toBe(true);
    expect(document.data_basis.hallucinated_keys).toEqual(["oura.made.up.2026-01-01"]);
  });

  test("a label-only Evidence section cites no key but still gets an attribution chip", () => {
    const text = [
      "## Reasoning",
      "Synthetic reasoning.",
      "",
      "## Evidence Used",
      "- Sleep score was 82 on the first night",
      "",
      "## Answer",
      "Synthetic answer.",
      "",
      "## Uncertainty",
      "Synthetic uncertainty.",
    ].join("\n");
    const parsed = parseTwinAnswer(text, syntheticSummaries);
    expect(parsed.citedKeys).toEqual([]);
    expect(parsed.attribution).toEqual([
      {
        metricKey: "oura.sleep.score.2026-01-01",
        label: "Sleep score",
        value: 82,
        unit: undefined,
      },
    ]);
    const document = buildResponseDocumentV1({ parsed, toolCalls: [], mode: "personal" });
    expect(document.data_basis.evidence_keys).toEqual([]);
    expect(document.data_basis.hallucinated_keys).toEqual([]);
    // A label match is attribution only; it never makes the answer sufficient.
    expect(document.sufficient_data).toBe(false);
    expect(document.abstained).toBe(true);
  });

  test("an unbracketed key-like bullet is cited; other bullet words are not", () => {
    const document = documentOf(
      answerCiting([]).replace(
        "## Evidence Used\n",
        "## Evidence Used\n- oura.sleep.score.2026-01-01: 82\n- Recovery felt fine\n",
      ),
    );
    expect(document.data_basis.evidence_keys).toEqual(["oura.sleep.score.2026-01-01"]);
    expect(document.data_basis.hallucinated_keys).toEqual([]);
  });

  test("[oura.sleep] is two segments short of an offered key and is hallucinated", () => {
    const document = documentOf(answerCiting(["oura.sleep"]));
    expect(document.data_basis.evidence_keys).toEqual([]);
    expect(document.data_basis.hallucinated_keys).toEqual(["oura.sleep"]);
    expect(document.sufficient_data).toBe(false);
  });
});

/** The dosing case from tests/guardrails/cases.json, and the `REFUSE:` form the prompt asks for. */
const REFUSE_CASE_TEXT =
  "REFUSE\n\nI cannot give a dose. Ask a clinician about medication amounts.";
const REFUSE_PROMPT_TEXT = "REFUSE: I cannot pick a dose; a clinician can.";

const TOOL_EMPTY: ResponseToolCall = { ...TOOL_WINDOW, row_count: 0 };

const NO_UNCERTAINTY_TEXT = [
  "## Reasoning",
  "Synthetic reasoning.",
  "",
  "## Evidence Used",
  "- [oura.sleep.score.2026-01-01]",
  "",
  "## Answer",
  "Sleep score is 82 in the list.",
].join("\n");

const syntheticGbdRow = {
  measure: "deaths",
  cause: "Cardiovascular diseases",
  location: "Switzerland",
  year: "2021",
  sex: "both",
  age: "all_ages",
  value: 12.5,
  lower: 10,
  upper: 15,
  unit: "per 100,000",
  source: "IHME GBD 2021",
};

const gbdFields = {
  measure: "deaths",
  cause: "Cardiovascular diseases",
  location: "Switzerland",
  age: "all_ages",
  sex: "both",
  year: "2021",
} as const;

const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** As the audit chain records a GBD call: hashes of the args and the normalised rows. */
const GBD_QUERY: ResponseToolCall = {
  seq: 4,
  tool: "gbd.gbd_query",
  args_sha256: sha256(gbdFields),
  result_sha256: sha256([syntheticGbdRow]),
  row_count: 1,
  ts: "2026-10-17T09:41:07.312Z",
};

const POPULATION_TEXT = [
  "## Reasoning",
  "Only a GBD population figure is available; no personal data was offered.",
  "",
  "## Evidence Used",
  "- none",
  "",
  "## Answer",
  "In Switzerland in 2021, GBD estimates 12.5 cardiovascular deaths per 100,000 (10–15).",
  "",
  "## Uncertainty",
  "Population figures describe no single person.",
].join("\n");

const v11Fields = (document: ResponseDocumentV1) => ({
  answer_class: document.answer_class,
  uncertainty: document.uncertainty,
  next_step: document.next_step,
  interpretation: document.interpretation,
});

describe("parseTwinAnswer v1.1 fields", () => {
  test("declined is true only when the reply opens with REFUSE", () => {
    expect(parseTwinAnswer(REFUSE_CASE_TEXT, emptySummaries).declined).toBe(true);
    expect(parseTwinAnswer(REFUSE_PROMPT_TEXT, emptySummaries).declined).toBe(true);
    expect(
      parseTwinAnswer("**REFUSE:** I cannot pick a dose.", emptySummaries).declined,
    ).toBe(true);
    expect(parseTwinAnswer(WEARABLE_TEXT, syntheticSummaries).declined).toBe(false);
    expect(parseTwinAnswer("I will not REFUSE this.", emptySummaries).declined).toBe(
      false,
    );
  });

  test("offeredKeyCount is the number of keys the prompt listed", () => {
    expect(parseTwinAnswer(WEARABLE_TEXT, syntheticSummaries).offeredKeyCount).toBe(2);
    expect(parseTwinAnswer(WEARABLE_TEXT, emptySummaries).offeredKeyCount).toBe(0);
  });
});

describe("ResponseDocument v1.1 answer_class", () => {
  test("information: a guideline-only answer", () => {
    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(ABSTAIN_TEXT, emptySummaries),
      toolCalls: [GUIDELINE_ONLY],
      mode: "personal",
      guidelineSources: [citation],
    });
    expect(v11Fields(document)).toEqual({
      answer_class: "information",
      uncertainty: {
        model_statement: "No observations in the window.",
        level: "moderate",
        reasons: ["no_personal_data", "guideline_only"],
      },
      // A tool returned rows (the guideline search), so not connect_wearable.
      next_step: "more_data",
      interpretation: { kind: "none" },
    });
  });

  test("information: a population-only answer is shown, not withheld", () => {
    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(POPULATION_TEXT, emptySummaries),
      toolCalls: [GBD_QUERY],
      mode: "personal",
      gbdSources: [{ tool: "gbd.gbd_query", fields: gbdFields }],
      gbdRows: [syntheticGbdRow],
    });
    expect(document.sufficient_data).toBe(false);
    expect(document.abstained).toBe(false);
    expect(document.data_basis.sources).toEqual({
      gbd: [{ tool: "gbd.gbd_query", fields: gbdFields }],
      guidelines: [],
      knowledge: [],
    });
    expect(v11Fields(document)).toEqual({
      answer_class: "information",
      uncertainty: {
        model_statement: "Population figures describe no single person.",
        level: "moderate",
        reasons: ["no_personal_data", "population_only"],
      },
      // GBD rows are not something about this person to read.
      next_step: "connect_wearable",
      interpretation: { kind: "none" },
    });
  });

  test("information: a knowledge-only answer", () => {
    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(KNOWLEDGE_TEXT, emptySummaries),
      toolCalls: [KNOWLEDGE_ONLY],
      mode: "synthetic",
      knowledgeSources: [knowledgeCitation],
    });
    expect(document).toEqual({
      schema_version: RESPONSE_SCHEMA_VERSION,
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: false,
      abstained: false,
      answer_class: "information",
      data_basis: {
        evidence_keys: [],
        hallucinated_keys: [],
        tool_calls: [KNOWLEDGE_ONLY],
        sources: { gbd: [], guidelines: [], knowledge: [knowledgeCitation] },
        gbd_rows: [],
      },
      uncertainty: {
        model_statement: "This describes the metric, not any person's values.",
        level: "moderate",
        reasons: ["no_personal_data", "knowledge_only"],
      },
      next_step: "more_data",
      interpretation: { kind: "none" },
    });
  });

  test("analytics: an answer citing an offered key", () => {
    expect(documentOf(WEARABLE_TEXT).answer_class).toBe("analytics");
  });

  test("declined_decision_support: the dosing refusal, whole document", () => {
    expect(documentOf(REFUSE_CASE_TEXT, [], emptySummaries)).toEqual({
      schema_version: "twin-llm.response.v1.1",
      intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
      not_for_diagnostic_use: true,
      sufficient_data: false,
      abstained: true,
      answer_class: "declined_decision_support",
      data_basis: {
        evidence_keys: [],
        hallucinated_keys: [],
        tool_calls: [],
        sources: { gbd: [], guidelines: [], knowledge: [] },
        gbd_rows: [],
      },
      uncertainty: { model_statement: null, level: "high", reasons: ["declined"] },
      next_step: "consult_clinician",
      interpretation: { kind: "none" },
    });
  });

  test("a decline after a tool returned rows is still declined, with no narration", () => {
    const document = documentOf(
      REFUSE_PROMPT_TEXT,
      [TOOL_LATEST],
      emptySummaries,
      "synthetic",
    );
    expect(document.sufficient_data).toBe(true);
    expect(document.abstained).toBe(false);
    expect(v11Fields(document)).toEqual({
      answer_class: "declined_decision_support",
      uncertainty: { model_statement: null, level: "high", reasons: ["declined"] },
      next_step: "consult_clinician",
      interpretation: { kind: "none" },
    });
  });
});

describe("ResponseDocument v1.1 uncertainty level", () => {
  test("low: an offered key, a model statement, every lookup returned rows", () => {
    expect(documentOf(MIXED_TEXT, [TOOL_LATEST, TOOL_WINDOW]).uncertainty).toEqual({
      model_statement: "Two sources still cover one night.",
      level: "low",
      reasons: [],
    });
  });

  test("moderate: sufficient, but one lookup returned no rows", () => {
    expect(v11Fields(documentOf(WEARABLE_TEXT, [TOOL_EMPTY]))).toEqual({
      answer_class: "analytics",
      uncertainty: {
        model_statement: "One day is not a trend. Missing days are not zero.",
        level: "moderate",
        reasons: ["tool_returned_no_rows"],
      },
      next_step: "none",
      interpretation: {
        kind: "narration",
        text: "Recovery on 2026-01-02 is 64 in the injected list.",
        narration_is_unverified: true,
      },
    });
  });

  test("high: sufficient, but one cited key was invented", () => {
    const document = documentOf(
      answerCiting(["oura.sleep.score.2026-01-01", "oura.sleep.invented.2026-01-01"]),
    );
    expect(document.answer_class).toBe("analytics");
    expect(document.uncertainty).toEqual({
      model_statement: "Synthetic uncertainty.",
      level: "high",
      reasons: ["hallucinated_keys"],
    });
    expect(document.next_step).toBe("none");
  });

  test("moderate: population rows only, no person-level data", () => {
    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(ABSTAIN_TEXT, emptySummaries),
      toolCalls: [GBD_QUERY],
      mode: "synthetic",
      gbdSources: [{ tool: "gbd.gbd_query", fields: gbdFields }],
      gbdRows: [syntheticGbdRow],
    });
    expect(document.abstained).toBe(false);
    expect(v11Fields(document).uncertainty.level).toBe("moderate");
  });

  test("no_model_statement: an answer without an Uncertainty section stays low", () => {
    expect(documentOf(NO_UNCERTAINTY_TEXT).uncertainty).toEqual({
      model_statement: null,
      level: "low",
      reasons: ["no_model_statement"],
    });
  });
});

describe("ResponseDocument v1.1 next_step", () => {
  test("none when sufficient", () => {
    expect(
      documentOf(TOOL_ONLY_TEXT, [TOOL_LATEST], emptySummaries, "synthetic").next_step,
    ).toBe("none");
  });

  test("more_data in personal mode when keys were offered but none cited", () => {
    expect(documentOf(ABSTAIN_TEXT).next_step).toBe("more_data");
  });

  test("connect_wearable in personal mode when nothing was offered and no rows came back", () => {
    expect(v11Fields(documentOf(ABSTAIN_TEXT, [TOOL_EMPTY], emptySummaries))).toEqual({
      answer_class: "information",
      uncertainty: {
        model_statement: "No observations in the window.",
        level: "high",
        reasons: ["no_personal_data", "tool_returned_no_rows"],
      },
      next_step: "connect_wearable",
      interpretation: { kind: "none" },
    });
  });

  test("more_data, not connect_wearable, in synthetic mode with the same turn", () => {
    expect(
      documentOf(ABSTAIN_TEXT, [TOOL_EMPTY], emptySummaries, "synthetic").next_step,
    ).toBe("more_data");
  });

  test("consult_clinician when declined, in either mode", () => {
    expect(documentOf(REFUSE_CASE_TEXT, [], emptySummaries, "personal").next_step).toBe(
      "consult_clinician",
    );
    expect(documentOf(REFUSE_CASE_TEXT, [], emptySummaries, "synthetic").next_step).toBe(
      "consult_clinician",
    );
  });
});
