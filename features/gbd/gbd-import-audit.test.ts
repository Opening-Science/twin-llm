import { describe, expect, test } from "bun:test";

import { gbdDeleteEvent, gbdImportEvent } from "./gbd-import-audit";

const CONTEXT = { actor: "local-synthetic", sessionId: "session-1" };

describe("GBD import audit rows (#426)", () => {
  test("an import holds the size, checksum and counts", () => {
    expect(
      gbdImportEvent(
        CONTEXT,
        { bytes: 10, sha256: "a" },
        { kind: "imported", rows: 3, newRows: 2 },
      ),
    ).toEqual({
      actor: "local-synthetic",
      sessionId: "session-1",
      subjectRef: null,
      tool: "gbd.import",
      args: { bytes: 10, sha256: "a" },
      result: { stored: true, rows: 3, new_rows: 2 },
      rowCount: 2,
    });
  });

  test("a skip and a refusal store nothing", () => {
    expect(
      gbdImportEvent(CONTEXT, { bytes: 1, sha256: "a" }, { kind: "already-imported" })
        .result,
    ).toEqual({ stored: false, skipped: "already-imported" });
    const refused = gbdImportEvent(
      CONTEXT,
      { bytes: 0, sha256: null },
      { kind: "refused", code: "GBD_CSV_ROW" },
    );
    expect([refused.result, refused.rowCount]).toEqual([
      { stored: false, refused: "GBD_CSV_ROW" },
      0,
    ]);
  });

  test("a delete holds the checksum and the rows it removed", () => {
    expect(gbdDeleteEvent(CONTEXT, "a", 5)).toMatchObject({
      tool: "gbd.delete",
      args: { sha256: "a" },
      result: { found: true, rows_deleted: 5 },
      rowCount: 5,
    });
    expect(gbdDeleteEvent(CONTEXT, "a", null).result).toEqual({
      found: false,
      rows_deleted: 0,
    });
  });
});
