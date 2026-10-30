import { describe, expect, test } from "bun:test";

import { fileArgs, reviewEvent } from "./import-audit";

const CONTEXT = { actor: "actor-1", sessionId: "session-1" };

describe("fileArgs", () => {
  test("kind, bytes and the file's SHA-256; never a genome file's hash", () => {
    expect(fileArgs({ kind: "lab-csv", byteSize: 10, sha256: "a".repeat(64) })).toEqual({
      kind: "lab-csv",
      bytes: 10,
      sha256: "a".repeat(64),
    });
    expect(fileArgs({ kind: "vcf", byteSize: 10, sha256: "a".repeat(64) })).toEqual({
      kind: "vcf",
      bytes: 10,
      sha256: null,
    });
    expect(fileArgs({ kind: null, byteSize: 0, sha256: null })).toEqual({
      kind: null,
      bytes: 0,
      sha256: null,
    });
  });

  test("a VCF review row holds counts only", () => {
    expect(
      reviewEvent(
        CONTEXT,
        { kind: "vcf", byteSize: 2048, sha256: "c".repeat(64) },
        { rowsToStore: 92, unmapped: 1 },
      ),
    ).toEqual({
      actor: "actor-1",
      sessionId: "session-1",
      subjectRef: null,
      tool: "personal-data.review",
      args: { kind: "vcf", bytes: 2048, sha256: null },
      result: { stored: false, rows: 92, unmapped: 1 },
      rowCount: 0,
    });
  });
});
