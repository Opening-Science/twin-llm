import { describe, expect, test } from "bun:test";

import {
  mergeStoredScanRefs,
  newestViatarForProbandId,
  scanRefsForViatars,
  scanSyncState,
  viatarsForProbandId,
} from "./viatars";

describe("newestViatarForProbandId", () => {
  test("filters GET /viatars/ rows by integer scan key and keeps the newest", () => {
    const listed = [
      {
        viatar_id: 1,
        proband_id: 7,
        meta: { crtime: "2026-01-01T00:00:00Z" },
      },
      {
        viatar_id: 4,
        proband_id: 7,
        meta: { crtime: "2026-09-01T00:00:00Z" },
      },
      {
        viatar_id: 9,
        proband_id: 3,
        meta: { crtime: "2026-12-01T00:00:00Z" },
      },
    ];
    const match = newestViatarForProbandId(listed, 7);
    expect(match?.viatar_id).toBe(4);
    expect(listed.map((row) => row.viatar_id)).toEqual([1, 4, 9]);
    expect(newestViatarForProbandId(listed, 99)).toBeUndefined();
    const forSeven = viatarsForProbandId(listed, 7);
    const stored = new Map([
      [
        4,
        {
          viatarId: 4,
          glbSha256: "abc",
          markers: [],
          presetName: null,
        },
      ],
    ] as const);
    expect(scanRefsForViatars(forSeven, stored, "scanner")).toEqual([
      {
        viatarId: 1,
        crtime: "2026-01-01T00:00:00Z",
        synced: false,
        incomplete: false,
        presetName: null,
      },
      {
        viatarId: 4,
        crtime: "2026-09-01T00:00:00Z",
        synced: true,
        incomplete: false,
        presetName: null,
      },
    ]);
    expect(scanRefsForViatars(forSeven).some((row) => row.synced === false)).toBe(true);
  });

  test("lists unsynced viatars with a preset name from the scanner row", () => {
    const listed = [
      {
        viatar_id: 2,
        proband_id: 7,
        preset: "Marker Only",
        meta: { crtime: "2026-08-01T00:00:00Z" },
      },
    ];
    expect(scanRefsForViatars(listed, new Map(), "scanner")).toEqual([
      {
        viatarId: 2,
        crtime: "2026-08-01T00:00:00Z",
        synced: false,
        incomplete: false,
        presetName: "Marker Only",
      },
    ]);
  });

  test("file-only snapshots appear as complete scans when they are not on the live list", () => {
    expect(
      mergeStoredScanRefs(
        [],
        [
          {
            viatarId: 11,
            crtime: "2026-07-10T12:00:00.000Z",
            presetName: null,
            glbSha256: "abc",
            markers: null,
          },
        ],
        "file",
      ),
    ).toEqual([
      {
        viatarId: 11,
        crtime: "2026-07-10T12:00:00.000Z",
        synced: true,
        incomplete: false,
        presetName: null,
      },
    ]);
    expect(
      mergeStoredScanRefs(
        [
          {
            viatarId: 2,
            crtime: "2026-08-01T00:00:00Z",
            synced: false,
            incomplete: false,
            presetName: "Marker Only",
          },
        ],
        [
          {
            viatarId: 2,
            crtime: "2026-08-01T00:00:00Z",
            presetName: "Marker Only",
            glbSha256: null,
            markers: null,
          },
        ],
        "scanner",
      ),
    ).toHaveLength(1);
  });
});

describe("scanSyncState", () => {
  test("scanner snapshots without a glb or markers column are incomplete", () => {
    expect(scanSyncState({ subjectKind: "scanner", snapshot: null })).toBe("missing");
    expect(
      scanSyncState({
        subjectKind: "scanner",
        snapshot: { viatarId: 2, glbSha256: null, markers: null, presetName: null },
      }),
    ).toBe("incomplete");
    expect(
      scanSyncState({
        subjectKind: "scanner",
        snapshot: { viatarId: 3, glbSha256: "abc", markers: null, presetName: null },
      }),
    ).toBe("incomplete");
    expect(
      scanSyncState({
        subjectKind: "scanner",
        snapshot: { viatarId: 4, glbSha256: "abc", markers: [], presetName: null },
      }),
    ).toBe("complete");
  });

  test("file subjects are complete with a glb or with measurements only", () => {
    expect(
      scanSyncState({
        subjectKind: "file",
        snapshot: { viatarId: 11, glbSha256: "abc", markers: null, presetName: null },
      }),
    ).toBe("complete");
    expect(
      scanSyncState({
        subjectKind: "file",
        snapshot: {
          viatarId: 12,
          glbSha256: null,
          markers: null,
          measures: [{ kind: "height", path: "head.vertex", value: 1.57, unit: "m" }],
          presetName: null,
        },
      }),
    ).toBe("complete");
    expect(
      scanSyncState({
        subjectKind: "file",
        snapshot: { viatarId: 13, glbSha256: null, markers: null, presetName: null },
      }),
    ).toBe("incomplete");
  });
});
