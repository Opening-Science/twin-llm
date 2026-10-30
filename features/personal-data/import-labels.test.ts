import { describe, expect, test } from "bun:test";

import {
  byteSizeLabel,
  countLabel,
  datasetContentsLabel,
  dateRangeLabel,
  previewCellLabel,
  storedDateLabel,
} from "./import-labels";

describe("import labels", () => {
  test("stored dates at their own precision", () => {
    expect(
      ["2024", "2024-03", "2024-03-09", "2025-05-20T06:30:00.000Z", "soon"].map(
        storedDateLabel,
      ),
    ).toEqual(["2024", "Mar 2024", "9 Mar 2024", "20 May 2025", "—"]);
    expect(storedDateLabel(null)).toBe("—");
  });

  test("a range collapses when both ends are the same day", () => {
    expect(dateRangeLabel("2024-02-10", "2025-05-20T06:30:00.000Z")).toBe(
      "10 Feb 2024 to 20 May 2025",
    );
    expect(dateRangeLabel("2024-02-10", "2024-02-10T08:00:00.000Z")).toBe("10 Feb 2024");
    expect(dateRangeLabel(null, null)).toBe("no dates");
  });

  test("counts and sizes", () => {
    expect([countLabel(1, "row", "rows"), countLabel(12345, "row", "rows")]).toEqual([
      "1 row",
      "12,345 rows",
    ]);
    expect([byteSizeLabel(515), byteSizeLabel(52_428_800)]).toEqual([
      "0.5 kB",
      "52.4 MB",
    ]);
  });

  test("preview cells are shown exactly as stored", () => {
    expect([
      previewCellLabel(0.123456),
      previewCellLabel(null),
      previewCellLabel("a"),
    ]).toEqual(["0.123456", "—", "a"]);
  });
});

describe("datasetContentsLabel", () => {
  test("a VCF counts variant records; others count rows with dates", () => {
    expect(
      datasetContentsLabel({ kind: "vcf", rowCount: 92, firstAt: null, lastAt: null }),
    ).toBe("92 variant records");
    expect(
      datasetContentsLabel({ kind: "vcf", rowCount: 1, firstAt: null, lastAt: null }),
    ).toBe("1 variant record");
    expect(
      datasetContentsLabel({
        kind: "lab-csv",
        rowCount: 9,
        firstAt: "2024-02",
        lastAt: "2024-02",
      }),
    ).toBe("9 rows · Feb 2024");
  });
});
