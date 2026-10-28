import { describe, expect, test } from "bun:test";

import { toResponseDocument } from "./parse";

const valid = {
  schema_version: "twin-llm.response.v1",
  intended_use: "research_hypothesis_generation_n_of_1",
  not_for_diagnostic_use: true,
  sufficient_data: false,
  abstained: true,
  data_basis: {
    evidence_keys: [],
    hallucinated_keys: [],
    tool_calls: [],
    sources: { gbd: [], guidelines: [] },
    gbd_rows: [],
  },
  uncertainty: { model_statement: null },
  next_step: "more_data",
  interpretation: { kind: "none" },
};

describe("toResponseDocument", () => {
  test("an old v1 row parses as v1 with the v1.1 defaults", () => {
    expect(toResponseDocument(valid)).toEqual({
      ...valid,
      data_basis: {
        ...valid.data_basis,
        sources: { gbd: [], guidelines: [], knowledge: [], literature: [] },
      },
      schema_version: "twin-llm.response.v1",
      answer_class: "information",
      uncertainty: { model_statement: null, level: "unknown", reasons: [] },
    });
  });

  test("a v1.1 document parses unchanged", () => {
    const v11 = {
      ...valid,
      data_basis: {
        ...valid.data_basis,
        sources: { gbd: [], guidelines: [], knowledge: [], literature: [] },
      },
      schema_version: "twin-llm.response.v1.1",
      answer_class: "information",
      uncertainty: {
        model_statement: null,
        level: "high",
        reasons: ["no_personal_data", "tool_returned_no_rows"],
      },
      next_step: "connect_wearable",
    };
    expect(toResponseDocument(v11)).toEqual(v11);
  });

  test("an unknown v1.1 code is dropped, not passed through", () => {
    expect(
      toResponseDocument({
        ...valid,
        schema_version: "twin-llm.response.v1.1",
        uncertainty: { model_statement: null, level: "high", reasons: ["unspecified"] },
      }),
    ).toBeNull();
    expect(toResponseDocument({ ...valid, answer_class: "diagnosis" })).toBeNull();
    expect(toResponseDocument({ ...valid, next_step: "see_a_doctor" })).toBeNull();
  });

  test("a document saved before hallucinated_keys existed parses with []", () => {
    const { hallucinated_keys: _dropped, ...dataBasis } = valid.data_basis;
    const parsed = toResponseDocument({ ...valid, data_basis: dataBasis });
    expect(parsed?.data_basis.hallucinated_keys).toEqual([]);
  });

  test("a document saved before sources.knowledge existed parses with []", () => {
    expect(valid.data_basis.sources).toEqual({ gbd: [], guidelines: [] });
    expect(toResponseDocument(valid)?.data_basis.sources.knowledge).toEqual([]);
  });

  test("a knowledge source parses as stored", () => {
    const knowledge = [
      {
        tool: "knowledge.knowledge_search",
        id: "opentwin-metric-glossary",
        title: "Metric glossary",
        file: "knowledge/opentwin/metric-glossary.md",
        sectionHeading: "Heart rate variability (HRV)",
        licence: "cc-by-4.0",
      },
    ];
    const parsed = toResponseDocument({
      ...valid,
      data_basis: {
        ...valid.data_basis,
        sources: { gbd: [], guidelines: [], knowledge },
      },
    });
    expect(parsed?.data_basis.sources.knowledge).toEqual(knowledge);
  });

  test("a knowledge source without its file is dropped, not passed through", () => {
    expect(
      toResponseDocument({
        ...valid,
        data_basis: {
          ...valid.data_basis,
          sources: {
            gbd: [],
            guidelines: [],
            knowledge: [{ tool: "knowledge.knowledge_search", id: "x", title: "X" }],
          },
        },
      }),
    ).toBeNull();
  });

  test("a narration saved before narration_is_unverified existed parses as true", () => {
    const parsed = toResponseDocument({
      ...valid,
      sufficient_data: true,
      abstained: false,
      next_step: "none",
      interpretation: { kind: "narration", text: "Synthetic answer." },
    });
    expect(parsed?.interpretation).toEqual({
      kind: "narration",
      text: "Synthetic answer.",
      narration_is_unverified: true,
    });
  });

  test("returns null for a malformed document", () => {
    expect(toResponseDocument({ ...valid, abstained: "yes" })).toBeNull();
    expect(
      toResponseDocument({ ...valid, schema_version: "twin-llm.response.v2" }),
    ).toBeNull();
  });

  test("returns null for missing input", () => {
    expect(toResponseDocument(undefined)).toBeNull();
    expect(toResponseDocument(null)).toBeNull();
  });
});
