import { describe, expect, mock, test } from "bun:test";

import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";

import { buildResponseDocumentV1 } from "./build-document";
import { querySessionAudit } from "./session-audit";

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const HASH_D = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

describe("loadSessionAudit", () => {
  test("maps audit rows for session_id=turnId and ignores other sessions", async () => {
    const findMany = mock(async (args: { where: { sessionId: string } }) => {
      if (args.where.sessionId !== "turn-golden") return [];
      return [
        {
          seq: BigInt(1),
          tool: "latest_by_loinc",
          argsSha256: HASH_A,
          resultSha256: HASH_B,
          rowCount: 1,
          ts: new Date("2026-09-27T12:00:00.000Z"),
        },
        {
          seq: BigInt(2),
          tool: "subject_window",
          argsSha256: HASH_C,
          resultSha256: HASH_D,
          rowCount: 2,
          ts: new Date("2026-09-27T12:00:01.000Z"),
        },
      ];
    });

    const client = { auditEvent: { findMany } };

    const other = await querySessionAudit(client, "turn-other");
    expect(other).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: "turn-other" } }),
    );

    const rows = await querySessionAudit(client, "turn-golden");
    expect(rows).toEqual([
      {
        seq: 1,
        tool: "latest_by_loinc",
        args_sha256: HASH_A,
        result_sha256: HASH_B,
        row_count: 1,
        ts: "2026-09-27T12:00:00.000Z",
      },
      {
        seq: 2,
        tool: "subject_window",
        args_sha256: HASH_C,
        result_sha256: HASH_D,
        row_count: 2,
        ts: "2026-09-27T12:00:01.000Z",
      },
    ]);

    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(
        [
          "## Reasoning",
          "Use the audit rows only.",
          "",
          "## Evidence Used",
          "- none",
          "",
          "## Answer",
          "Two tool rows landed.",
          "",
          "## Uncertainty",
          "Hashes only; no payload.",
        ].join("\n"),
        { oura: null, whoop: null, googleHealth: null, vitronic: null },
      ),
      toolCalls: rows,
      mode: "synthetic",
    });

    expect(document.data_basis.tool_calls).toEqual(rows);
    expect(document.sufficient_data).toBe(true);
    expect(document.interpretation.kind).toBe("narration");
  });
});
