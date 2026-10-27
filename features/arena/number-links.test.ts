import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { NumberSource } from "@/infrastructure/number-sources";

import { AnswerBody } from "./answer-body";
import {
  cardNumbers,
  numberLinkPieces,
  sourceCallIds,
  sourcesByText,
} from "./number-links";
import { toSavedResponseState } from "./saved-response-state";

const SOURCES: readonly NumberSource[] = [
  { text: "62", start: 20, end: 22, toolCallId: "1", rowIndex: 0, field: "value" },
  { text: "62", start: 20, end: 22, toolCallId: "1", rowIndex: 3, field: "value" },
  { text: "62", start: 20, end: 22, toolCallId: "2", field: "mean" },
  { text: "5.9", start: 40, end: 43, toolCallId: "2", field: "min" },
];

describe("numberLinkPieces", () => {
  test("splits a run into text and sourced numbers; dates and unsourced numbers stay text", () => {
    expect(
      numberLinkPieces(
        "Resting heart rate 62 bpm on 3 Mar 2026, 5.9 % low, 71 high.",
        sourcesByText(SOURCES),
      ),
    ).toEqual([
      "Resting heart rate ",
      { text: "62", sources: SOURCES.slice(0, 3) },
      " bpm on 3 Mar 2026, ",
      { text: "5.9", sources: [SOURCES[3]] },
      " % low, 71 high.",
    ]);
  });

  test("a run with no sources is one piece", () => {
    expect(numberLinkPieces("62 bpm", sourcesByText([]))).toEqual(["62 bpm"]);
  });
});

describe("card numbers", () => {
  test("lists each number a call holds once, with rows from 1 and the field", () => {
    expect(cardNumbers(SOURCES, "1")).toEqual([
      { text: "62", where: "rows 1, 4 · value" },
    ]);
    expect(cardNumbers(SOURCES, "2")).toEqual([
      { text: "62", where: "mean" },
      { text: "5.9", where: "min" },
    ]);
    expect(sourceCallIds(SOURCES)).toEqual(["1", "2"]);
  });
});

const stored = [
  {
    seq: 1,
    tool: "observations_for_subject",
    input: { subject_ref: "synthetic-subject-1", loinc: "8867-4" },
    output: {
      rows: [
        { loinc: "8867-4", value: 61.6, unit_ucum: "/min", effective: "2026-03-01" },
        { loinc: "8867-4", value: 74.3, unit_ucum: "/min", effective: "2026-03-02" },
      ],
    },
    argsSha256: "a".repeat(64),
    resultSha256: "b".repeat(64),
    rowCount: 2,
    at: "2026-10-15T09:00:00.000Z",
  },
];

const row = {
  id: "response-1",
  modelId: "synthetic/model",
  modelName: "Synthetic",
  status: "COMPLETE" as const,
  text: "## Answer\nYour resting heart rate was 62 bpm on 1 Mar 2026; 90 is a guess.",
  reasoningText: null,
  attribution: null,
  responseDocument: null,
  toolParts: stored,
  timeToFirstTokenMs: 100,
  tokensPerSecond: 10,
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  costUsd: 0,
};

describe("a saved answer's numbers", () => {
  test("are matched on the server to the stored call and row, without its values", () => {
    const state = toSavedResponseState(row);
    expect(state.numberSources).toEqual([
      {
        text: "62",
        start: row.text.indexOf("62"),
        end: row.text.indexOf("62") + 2,
        toolCallId: "1",
        rowIndex: 0,
        field: "value",
      },
    ]);
    // The row's own values never reach the browser state.
    expect(JSON.stringify(state).includes("61.6")).toBe(false);
    expect(JSON.stringify(state).includes("74.3")).toBe(false);
  });

  test("a withheld or unfinished answer has none", () => {
    expect(toSavedResponseState({ ...row, status: "STREAMING" }).numberSources).toEqual(
      [],
    );
  });

  test("render as buttons described by their card; an unsourced number stays text", () => {
    const markup = renderToStaticMarkup(
      createElement(AnswerBody, {
        response: toSavedResponseState(row),
        wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
      }),
    );
    const button =
      /<button type="button" class="number-link" aria-describedby="([^"]+)">62<\/button>/.exec(
        markup,
      );
    expect(button?.[1]?.endsWith("-tool-1")).toBe(true);
    expect(markup.includes(`id="${button?.[1]}"`)).toBe(true);
    expect(markup.includes("; 90 is a guess.")).toBe(true);
    expect(markup.includes(">90</button>")).toBe(false);
    expect(markup.includes("Numbers in the answer from this call")).toBe(true);
    expect(markup.includes("row 1 · value")).toBe(true);
  });
});
