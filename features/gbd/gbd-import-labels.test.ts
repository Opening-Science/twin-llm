import { describe, expect, test } from "bun:test";

import {
  gbdImportCountsLabel,
  gbdImportedOn,
  gbdLatticeState,
  gbdRefusalText,
  gbdStatusText,
  splitGbdSelection,
} from "./gbd-import-labels";

const VIEW = {
  sha256: "a".repeat(64),
  fileName: "IHME-GBD_2023_DATA-1.csv",
  release: "2023",
  rowCount: 1234,
  newRows: 1200,
  importedAt: "2026-11-02T10:00:00.000Z",
  citation: null,
  storedRows: 1,
};

describe("GBD import labels (#426)", () => {
  test("the lattice works until the file is in, skipped, refused or failed", () => {
    expect(
      [
        { phase: "waiting" },
        { phase: "sending", percent: 10 },
        { phase: "reading", rows: 5 },
        { phase: "imported", rowCount: 1, newRows: 1 },
        { phase: "skipped" },
        { phase: "refused", error: { code: "GBD_CSV_ROW", message: "Bad." } },
        { phase: "failed", message: "No." },
      ].map((status) => gbdLatticeState(status as Parameters<typeof gbdLatticeState>[0])),
    ).toEqual(["working", "working", "working", "done", "done", "error", "error"]);
  });

  test("each phase in words", () => {
    expect(gbdStatusText({ phase: "waiting" })).toBe("Waiting");
    expect(gbdStatusText({ phase: "sending", percent: 42.4 })).toBe("Sending, 42%");
    expect(gbdStatusText({ phase: "reading", rows: 12345 })).toBe(
      "Reading, 12,345 rows so far",
    );
    expect(gbdStatusText({ phase: "imported", rowCount: 1, newRows: 0 })).toBe(
      "1 row, 0 new",
    );
    expect(gbdStatusText({ phase: "skipped" })).toBe("Already imported, skipped");
    expect(gbdStatusText({ phase: "failed", message: "Try again." })).toBe("Try again.");
    expect(
      gbdStatusText({
        phase: "failed",
        message: "Too large.",
        code: "GBD_UPLOAD_TOO_LARGE",
      }),
    ).toBe("Too large. (GBD_UPLOAD_TOO_LARGE)");
  });

  test("a refusal keeps the importer's message, code, line and missing columns", () => {
    expect(
      gbdRefusalText({ code: "GBD_CSV_ROW", message: "A row is bad.", line: 1204 }),
    ).toBe("A row is bad. (GBD_CSV_ROW, line 1,204)");
    expect(
      gbdStatusText({
        phase: "refused",
        error: { code: "GBD_CSV_COLUMNS", message: "Not an export.", missing: ["val"] },
      }),
    ).toBe("Not an export. Missing columns: val. (GBD_CSV_COLUMNS)");
  });

  test("a selection splits into CSV files, the citation and the rest", () => {
    const pick = (...names: string[]) => names.map((name) => ({ name }));
    expect(
      splitGbdSelection(pick("a.csv", "Citation.txt", "B.CSV", "notes.pdf")),
    ).toEqual({
      csv: pick("a.csv", "B.CSV"),
      citation: { name: "Citation.txt" },
      other: pick("notes.pdf"),
    });
    expect(splitGbdSelection(pick("a.csv")).citation).toBeNull();
  });

  test("an imported file's counts and day", () => {
    expect(gbdImportCountsLabel(VIEW)).toBe(
      "1,234 rows, 1,200 new when imported, 1 held now",
    );
    expect(gbdImportedOn(VIEW)).toBe("2026-11-02");
  });
});
