import { describe, expect, test } from "bun:test";

import { pickEndDate, pickStartDate, windowLimits } from "./sync-window";

const TODAY = "2026-11-18";
const THIRTY = { startDate: "2026-10-20", endDate: "2026-11-18" } as const;

describe("the date pickers' window", () => {
  test("From goes back at most 90 days from To; To goes no later than today", () => {
    expect(windowLimits(THIRTY, TODAY)).toEqual({
      startMin: "2026-08-21",
      endMax: "2026-11-18",
    });
    expect(
      windowLimits({ startDate: "2026-05-01", endDate: "2026-05-10" }, TODAY),
    ).toEqual({ startMin: "2026-02-10", endMax: "2026-07-29" });
  });

  test("a From more than 90 days back stops at the limit, keeping To", () => {
    expect(pickStartDate(THIRTY, "2026-06-01")).toEqual({
      startDate: "2026-08-21",
      endDate: "2026-11-18",
    });
  });

  test("a From inside the limit is kept as picked", () => {
    expect(pickStartDate(THIRTY, "2026-09-01")).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-11-18",
    });
  });

  test("a To more than 90 days after From stops at the limit, keeping From", () => {
    expect(
      pickEndDate(
        { startDate: "2026-05-01", endDate: "2026-05-10" },
        "2026-10-01",
        TODAY,
      ),
    ).toEqual({ startDate: "2026-05-01", endDate: "2026-07-29" });
  });

  test("a cleared or malformed pick keeps the window", () => {
    expect(pickStartDate(THIRTY, "")).toEqual(THIRTY);
    expect(pickEndDate(THIRTY, "2026-02-31", TODAY)).toEqual(THIRTY);
  });
});
