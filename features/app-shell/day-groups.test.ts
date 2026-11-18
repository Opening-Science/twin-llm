import { describe, expect, test } from "bun:test";

import type { RecentThread } from "@/infrastructure/recent-threads";

import { dayKey, groupByDay } from "./day-groups";

const thread = (id: string, updatedAt: string | null, touched = false): RecentThread => ({
  id,
  title: id,
  updatedAt,
  modelCount: 1,
  touched,
});

// 14 Nov 2026, 08:00 in Zurich (07:00 UTC).
const NOW = new Date("2026-11-14T07:00:00.000Z");

describe("dayKey", () => {
  test("is the calendar date in the given zone", () => {
    const late = new Date("2026-11-13T23:30:00.000Z");
    expect(dayKey(late, "UTC")).toBe("2026-11-13");
    expect(dayKey(late, "Europe/Zurich")).toBe("2026-11-14");
    expect(dayKey(late, "America/New_York")).toBe("2026-11-13");
  });
});

describe("groupByDay", () => {
  const zurich = { today: dayKey(NOW, "Europe/Zurich"), timeZone: "Europe/Zurich" };

  test("buckets by calendar day in the viewer's zone, never a rolling 24 hours", () => {
    const groups = groupByDay(
      [
        // 00:30 on the 14th in Zurich, still the 13th in UTC.
        thread("after-midnight", "2026-11-13T23:30:00.000Z"),
        // 23:50 on the 13th in Zurich: yesterday, though under 24 hours ago.
        thread("late-yesterday", "2026-11-13T22:50:00.000Z"),
        // Six calendar days before today.
        thread("six-days", "2026-11-08T10:00:00.000Z"),
        // Seven.
        thread("seven-days", "2026-11-07T10:00:00.000Z"),
      ],
      zurich,
    );
    expect(
      groups.map(({ label, threads }) => [label, threads.map(({ id }) => id)]),
    ).toEqual([
      ["Today", ["after-midnight"]],
      ["This week", ["late-yesterday", "six-days"]],
      ["Earlier", ["seven-days"]],
    ]);
  });

  test("the same thread falls on another day for a viewer in another zone", () => {
    const utc = { today: dayKey(NOW, "UTC"), timeZone: "UTC" };
    const groups = groupByDay(
      [thread("after-midnight", "2026-11-13T23:30:00.000Z")],
      utc,
    );
    expect(groups.map(({ label }) => label)).toEqual(["This week"]);
  });

  test("this tab's threads lead Today and empty groups are left out", () => {
    const groups = groupByDay(
      [
        thread("just-sent", null, true),
        thread("touched-old", "2026-10-01T10:00:00.000Z", true),
        thread("old", "2026-10-02T10:00:00.000Z"),
      ],
      zurich,
    );
    expect(
      groups.map(({ label, threads }) => [label, threads.map(({ id }) => id)]),
    ).toEqual([
      ["Today", ["just-sent", "touched-old"]],
      ["Earlier", ["old"]],
    ]);
  });
});
