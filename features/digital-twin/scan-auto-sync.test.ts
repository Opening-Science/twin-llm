import { describe, expect, test } from "bun:test";

import type { BodyTwinScan } from "./body-twin-types";
import {
  AUTO_RESYNC_WINDOW_MS,
  AUTO_SYNC_LIMIT,
  autoSyncScans,
  scansToAutoSync,
} from "./scan-auto-sync";

const NOW = Date.parse("2026-11-18T12:00:00Z");

const scan = (
  viatarId: number,
  crtime: string | null,
  state: "missing" | "incomplete" | "complete",
): BodyTwinScan => ({
  viatarId,
  crtime,
  synced: state === "complete",
  incomplete: state === "incomplete",
  presetName: null,
});

const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("scansToAutoSync", () => {
  test("takes never-stored scans, newest first, and leaves stored ones", () => {
    expect(
      scansToAutoSync(
        [
          scan(1, "2026-11-01T10:00:00Z", "complete"),
          scan(2, "2026-11-02T10:00:00Z", "missing"),
          scan(4, "2026-11-04T10:00:00Z", "missing"),
        ],
        NOW,
      ),
    ).toEqual([4, 2]);
  });

  test("an incomplete scan is fetched again only while it is under an hour old", () => {
    expect(
      scansToAutoSync(
        [
          scan(5, ago(10 * 60 * 1000), "incomplete"),
          scan(6, ago(AUTO_RESYNC_WINDOW_MS + 1), "incomplete"),
          scan(7, null, "incomplete"),
        ],
        NOW,
      ),
    ).toEqual([5]);
  });

  test("a scan without a time sorts last, ties by scan number", () => {
    expect(
      scansToAutoSync(
        [
          scan(5, null, "missing"),
          scan(6, "2026-11-02T10:00:00Z", "missing"),
          scan(7, "2026-11-02T10:00:00Z", "missing"),
        ],
        NOW,
      ),
    ).toEqual([7, 6, 5]);
  });

  test("stops at the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      scan(i + 1, `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`, "missing"),
    );
    expect(scansToAutoSync(many, NOW)).toHaveLength(AUTO_SYNC_LIMIT);
    expect(scansToAutoSync(many, NOW)[0]).toBe(10);
  });

  test("nothing new, nothing to do", () => {
    expect(scansToAutoSync([scan(1, null, "complete")], NOW)).toEqual([]);
    expect(scansToAutoSync([], NOW)).toEqual([]);
  });
});

describe("autoSyncScans", () => {
  test("syncs one by one, in order", async () => {
    const calls: number[] = [];
    const outcome = await autoSyncScans([4, 2], async (id) => {
      calls.push(id);
      return true;
    });
    expect(calls).toEqual([4, 2]);
    expect(outcome).toEqual({ synced: [4, 2], stopped: false });
  });

  test("stops at the first failure or throw and leaves the rest", async () => {
    const calls: number[] = [];
    expect(
      await autoSyncScans([4, 3, 2], async (id) => {
        calls.push(id);
        return id !== 3;
      }),
    ).toEqual({ synced: [4], stopped: true });
    expect(calls).toEqual([4, 3]);
    expect(
      await autoSyncScans([4, 3], async () => {
        throw new Error("offline");
      }),
    ).toEqual({ synced: [], stopped: true });
  });
});
