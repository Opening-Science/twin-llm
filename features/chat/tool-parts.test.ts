import { describe, expect, test } from "bun:test";

import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";

import { storedToolParts } from "./tool-parts";

const at = new Date("2026-10-15T09:00:00.000Z");

const input = { subject_ref: "synthetic-subject-1", loinc: "8867-4" };
const output = { rows: [{ value: 62, unit_ucum: "/min" }] };
const argsSha256 = sha256Hex(toCanonicalJson(input));
const resultSha256 = sha256Hex(toCanonicalJson(output));

describe("storedToolParts", () => {
  test("hashes each call like its audit row and takes that row's count", () => {
    const parts = storedToolParts(
      [{ toolName: "query_observations", input, output }],
      [
        {
          seq: 41,
          tool: "query_observations",
          args_sha256: argsSha256,
          result_sha256: resultSha256,
          row_count: 1,
          ts: "2026-10-15T08:59:58.000Z",
        },
      ],
      at,
    );
    expect(parts).toEqual([
      {
        seq: 1,
        tool: "query_observations",
        input,
        output,
        argsSha256,
        resultSha256,
        rowCount: 1,
        at: "2026-10-15T09:00:00.000Z",
      },
    ]);
  });

  test("a call without a matching audit row keeps its hashes and no count", () => {
    const parts = storedToolParts(
      [{ toolName: "guideline_search", input: { query: "synthetic" }, output: [] }],
      [],
      at,
    );
    expect(parts).toEqual([
      {
        seq: 1,
        tool: "guideline_search",
        input: { query: "synthetic" },
        output: [],
        argsSha256: sha256Hex(toCanonicalJson({ query: "synthetic" })),
        resultSha256: sha256Hex(toCanonicalJson([])),
        rowCount: null,
        at: "2026-10-15T09:00:00.000Z",
      },
    ]);
  });

  test("no tool results stores null", () => {
    expect(storedToolParts([], [], at)).toBeNull();
  });
});
