import { describe, expect, test } from "bun:test";

import {
  mergeScanRows,
  orderScans,
  pickDefaultScan,
  type ListedScan,
} from "./scan-default";

const row = (
  viatarId: number,
  state: "synced" | "incomplete" | "missing",
  crtime: string | null = null,
): ListedScan => ({
  viatarId,
  crtime,
  synced: state === "synced",
  incomplete: state === "incomplete",
  presetName: null,
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T09:00:00.000Z`;

const syncedRun = [22, 23, 24, 25, 26, 27, 28].map((id) =>
  row(id, "synced", day(id - 20)),
);

describe("orderScans", () => {
  test("synced first, then incomplete, then not synced; newest first within each", () => {
    const ordered = orderScans([
      row(30, "missing", day(10)),
      row(21, "incomplete", day(1)),
      ...syncedRun,
      row(29, "missing", day(9)),
    ]);
    expect(ordered.map((r) => r.viatarId)).toEqual([
      28, 27, 26, 25, 24, 23, 22, 21, 30, 29,
    ]);
  });

  test("rows without a date fall back to the higher scan number", () => {
    const ordered = orderScans([row(22, "synced"), row(28, "synced"), row(25, "synced")]);
    expect(ordered.map((r) => r.viatarId)).toEqual([28, 25, 22]);
  });
});

describe("pickDefaultScan", () => {
  test("a pinned synced scan wins over the newest", () => {
    expect(pickDefaultScan(syncedRun, 22)).toBe(22);
  });

  test("no pin opens the newest synced scan", () => {
    expect(pickDefaultScan([row(30, "missing", day(10)), ...syncedRun], null)).toBe(28);
  });

  test("a pin that is no longer synced falls back to the newest synced scan", () => {
    expect(
      pickDefaultScan([row(22, "incomplete", day(2)), row(28, "synced", day(8))], 22),
    ).toBe(28);
    expect(pickDefaultScan(syncedRun, 99)).toBe(28);
  });

  test("with nothing synced it opens the first ordered row, and empty is undefined", () => {
    expect(
      pickDefaultScan([row(3, "missing", day(3)), row(4, "incomplete", day(1))], null),
    ).toBe(4);
    expect(pickDefaultScan([], 22)).toBeUndefined();
  });
});

describe("mergeScanRows", () => {
  test("stored snapshots the scanner no longer lists still appear and can be synced", () => {
    const rows = mergeScanRows(
      [{ viatarId: 28, crtime: day(8) }],
      [
        { viatarId: 28, hasAvatar: true, properties: [], markers: [] },
        { viatarId: 22, hasAvatar: true, properties: [], markers: [] },
      ],
      "scanner",
    );
    expect(rows.map((r) => [r.viatarId, r.synced])).toEqual([
      [28, true],
      [22, true],
    ]);
  });

  test("scanner snapshots without markers are incomplete", () => {
    const rows = mergeScanRows(
      [{ viatarId: 22, crtime: day(2) }],
      [{ viatarId: 22, hasAvatar: true, properties: [], markers: null }],
      "scanner",
    );
    expect(rows[0]?.incomplete).toBe(true);
    expect(rows[0]?.synced).toBe(false);
  });
});
