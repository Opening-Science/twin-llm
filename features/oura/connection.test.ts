import { beforeEach, describe, expect, test } from "bun:test";

import type { OuraSummary } from "@/infrastructure/oura-types";

import { getLatestOuraSummary } from "./connection";

const USER_ID = "user-synthetic-1";

type FindFirstArgs = {
  where: { userId: string };
  orderBy: Record<string, string>;
  select?: Record<string, boolean>;
};

const STORED_SUMMARY: OuraSummary = {
  window: { startDate: "2026-01-01", endDate: "2026-01-04" },
  metrics: [
    {
      key: "oura.sleep.score.2026-01-02",
      label: "Oura sleep score (2026-01-02)",
      value: 82,
    },
  ],
  narrative: "Oura wearable context for 2026-01-01 to 2026-01-04.",
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

const fakeDatabase = () => ({
  ouraSnapshot: {
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
});

beforeEach(() => {
  recorded.snapshotQueries.length = 0;
  recorded.snapshotRows.length = 0;
});

describe("getLatestOuraSummary", () => {
  test("reads only the summary column, never the FHIR bundle", async () => {
    const result = await getLatestOuraSummary(USER_ID, {
      database: fakeDatabase as never,
    });

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
