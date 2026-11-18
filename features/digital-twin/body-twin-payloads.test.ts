import { describe, expect, test } from "bun:test";

import { scanLabel } from "./body-twin-payloads";

describe("scanLabel", () => {
  test("the scan day reads en-GB, not as an ISO date", () => {
    const label = scanLabel(
      { viatarId: 7, crtime: "2026-03-04T09:30:00Z", synced: true, presetName: null },
      null,
    );
    expect(label).toBe("4 Mar 2026 · scan 7 · synced");
  });

  test("a scan with no time says so; the pinned scan is tagged", () => {
    expect(scanLabel({ viatarId: 7, crtime: null }, 7)).toBe(
      "unknown date · scan 7 · not synced · default",
    );
  });
});
