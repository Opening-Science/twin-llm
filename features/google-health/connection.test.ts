import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";

const USER_ID = "user-synthetic-1";

type FindFirstArgs = {
  where: { userId: string };
  orderBy: Record<string, string>;
  select?: Record<string, boolean>;
};

const STORED_SUMMARY: GoogleHealthSummary = {
  window: { startDate: "2026-01-01", endDate: "2026-01-04" },
  metrics: [
    {
      key: "google-health.steps.2026-01-02",
      label: "Google Health steps (2026-01-02)",
      value: 8432,
    },
  ],
  narrative: "Google Health wearable context for 2026-01-01 to 2026-01-04.",
};

const STORED_SNAPSHOT: Record<string, unknown> = {
  id: "snapshot-synthetic-1",
  userId: USER_ID,
  startDate: "2026-01-01",
  endDate: "2026-01-04",
  summary: STORED_SUMMARY,
  fhirBundle: { resourceType: "Bundle", type: "collection", entry: [] },
  syncedAt: new Date("2026-01-05T00:00:00Z"),
};

const recorded = {
  snapshotQueries: [] as FindFirstArgs[],
  snapshotRows: [] as Record<string, unknown>[],
};

mock.module("server-only", () => ({}));
mock.module("@/infrastructure/database", () => ({
  database: () => ({
    googleHealthSnapshot: {
      findFirst: async (args: FindFirstArgs) => {
        recorded.snapshotQueries.push(args);
        const { select } = args;
        const row = select
          ? Object.fromEntries(
              Object.entries(STORED_SNAPSHOT).filter(([field]) => select[field] === true),
            )
          : { ...STORED_SNAPSHOT };
        recorded.snapshotRows.push(row);
        return row;
      },
    },
  }),
}));

beforeEach(() => {
  recorded.snapshotQueries.length = 0;
  recorded.snapshotRows.length = 0;
});

describe("getLatestGoogleHealthSummary", () => {
  test("reads only the summary column, never the FHIR bundle", async () => {
    const { getLatestGoogleHealthSummary } = await import("./connection");

    const result = await getLatestGoogleHealthSummary(USER_ID);

    expect(recorded.snapshotQueries).toEqual([
      {
        where: { userId: USER_ID },
        orderBy: { syncedAt: "desc" },
        select: { summary: true },
      },
    ]);
    expect(recorded.snapshotRows.map((row) => Object.keys(row))).toEqual([["summary"]]);
    expect(result).toEqual(STORED_SUMMARY);
    expect(Object.keys(result ?? {})).not.toContain("fhirBundle");
  });
});
