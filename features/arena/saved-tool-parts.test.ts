import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";

import { toSavedResponseState } from "./saved-response-state";
import { savedToolParts } from "./saved-tool-parts";

/** Stored out of seq order on purpose; the column is replayed in seq order. */
const stored = [
  {
    seq: 2,
    tool: "guideline_search",
    input: { query: "synthetic-query" },
    output: [{ id: "synthetic-guideline-1" }],
    argsSha256: "a".repeat(64),
    resultSha256: "b".repeat(64),
    rowCount: 1,
    at: "2026-10-15T09:00:00.000Z",
  },
  {
    seq: 1,
    tool: "query_observations",
    input: { subject_ref: "synthetic-subject-1", loinc: "8867-4" },
    output: { rows: [] },
    argsSha256: "c".repeat(64),
    resultSha256: "d".repeat(64),
    rowCount: 0,
    at: "2026-10-15T09:00:00.000Z",
  },
];

describe("savedToolParts", () => {
  test("replays the column as finished tool parts in seq order", () => {
    expect(savedToolParts(stored)).toEqual([
      {
        type: "tool-query_observations",
        toolCallId: "1",
        state: "output-available",
        input: { subject_ref: "synthetic-subject-1", loinc: "8867-4" },
        output: { rows: [] },
      },
      {
        type: "tool-guideline_search",
        toolCallId: "2",
        state: "output-available",
        input: { query: "synthetic-query" },
        output: [{ id: "synthetic-guideline-1" }],
      },
    ]);
  });

  test("a null column and a malformed one both replay as no parts", () => {
    expect(savedToolParts(null)).toEqual([]);
    expect(savedToolParts([{ tool: "query_observations" }])).toEqual([]);
  });
});

describe("toSavedResponseState", () => {
  const row = {
    id: "response-1",
    modelId: "synthetic/model",
    modelName: "Synthetic",
    status: "COMPLETE" as const,
    text: "## Answer\nSynthetic answer.",
    reasoningText: null,
    attribution: null,
    responseDocument: null,
    timeToFirstTokenMs: 100,
    tokensPerSecond: 10,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    costUsd: 0,
  };

  test("a saved answer carries its tools as a streamed one does", () => {
    expect(
      toSavedResponseState({ ...row, toolParts: stored }).tools?.map((card) => [
        card.tool,
        card.state,
        card.rowCount,
      ]),
    ).toEqual([
      ["query_observations", "done", 0],
      ["guideline_search", "done", 1],
    ]);
  });

  test("an answer without tool parts has none", () => {
    expect(toSavedResponseState({ ...row, toolParts: null }).tools).toEqual([]);
  });

  test("a reloaded answer draws the views its show_view calls returned", () => {
    const view = timeseriesView({
      spec: {
        measure: "sleep.score",
        label: "Sleep score",
        unit: null,
        window: { start: "2026-10-01", end: "2026-10-31" },
        subject: null,
        points: [{ at: "2026-10-01T00:00:00.000Z", value: 77 }],
      },
      sourceAuditIds: ["7"],
    });
    const showView = {
      ...stored[1]!,
      seq: 3,
      tool: "show_view",
      input: { kind: "chart.timeseries", measure: "sleep.score" },
      output: view,
    };
    const state = toSavedResponseState({ ...row, toolParts: [...stored, showView] });
    expect(state.views).toEqual([view]);
    expect(state.tools?.map((tool) => tool.tool)).toEqual([
      "query_observations",
      "guideline_search",
      "show_view",
    ]);
  });
});
