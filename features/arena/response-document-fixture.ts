import {
  RESPONSE_SCHEMA_VERSION,
  type ResponseDocumentInput,
  type ResponseDocumentV1,
  responseDocumentV1Schema,
} from "@/infrastructure/response-document/document-v1";

/**
 * Synthetic documents for markup tests. No real subject data. Overrides go
 * through the schema, so a field left out (say `uncertainty.level`) takes the
 * same default a stored document would.
 */
export const makeResponseDocument = (
  overrides: Partial<ResponseDocumentInput> = {},
): ResponseDocumentV1 =>
  responseDocumentV1Schema.parse({
    schema_version: RESPONSE_SCHEMA_VERSION,
    intended_use: "research_hypothesis_generation_n_of_1",
    not_for_diagnostic_use: true,
    sufficient_data: true,
    abstained: false,
    data_basis: {
      evidence_keys: [],
      hallucinated_keys: [],
      tool_calls: [],
      sources: { gbd: [], guidelines: [], knowledge: [] },
      gbd_rows: [],
    },
    uncertainty: { model_statement: null },
    next_step: "none",
    interpretation: {
      kind: "narration",
      text: "Synthetic answer.",
      narration_is_unverified: true,
    },
    ...overrides,
  });

export const syntheticKnowledge = {
  tool: "knowledge.knowledge_search",
  id: "opentwin-metric-glossary",
  title: "Metric glossary",
  file: "knowledge/opentwin/metric-glossary.md",
  sectionHeading: "Heart rate variability (HRV)",
  licence: "cc-by-4.0",
} as const;

export const syntheticGuideline = {
  tool: "guidelines.guideline_search",
  id: "ean-als-2024",
  title: "EAN/ERN EURO-NMD ALS",
  year: 2024,
  society: "EAN",
  doi: "10.1111/ene.example",
  url: "https://example.org/ean-als-2024",
  licence: "CC BY 4.0",
  ingestMode: "metadata",
  sectionHeading: null,
  recommendationId: null,
  recClass: null,
  evidenceLevel: null,
  page: null,
} as const;

export const syntheticGbdRow = {
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
} as const;

export const syntheticToolCall = (seq: number) =>
  ({
    seq,
    tool: "latest_by_loinc",
    args_sha256: "a".repeat(64),
    result_sha256: "b".repeat(64),
    row_count: 1,
    ts: "2026-10-15T09:00:00.000Z",
  }) as const;
