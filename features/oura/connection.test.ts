import { beforeEach, describe, expect, test } from "bun:test";

import { plainCipher } from "@/infrastructure/field-cipher";
import type { OuraSummary } from "@/infrastructure/oura-types";

import { getLatestOuraSummary, OURA_OAUTH_SCOPES, OURA_SYNC_TYPES } from "./connection";

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
  // Text columns since #141; the plain cipher of a synthetic install reads them.
  summary: JSON.stringify(STORED_SUMMARY),
  fhirBundle: JSON.stringify({ resourceType: "Bundle", type: "collection", entry: [] }),
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

describe("Oura sync request", () => {
  test("fetches the eight collections and asks for the scopes they need", () => {
    expect(OURA_SYNC_TYPES).toEqual([
      "personal_info",
      "sleep",
      "daily_readiness",
      "daily_activity",
      "workout",
      "daily_spo2",
      "daily_stress",
      "vO2_max",
    ]);
    expect(OURA_OAUTH_SCOPES).toEqual(["email", "personal", "daily", "workout", "spo2"]);
  });
});

describe("getLatestOuraSummary", () => {
  test("reads only the summary column, never the FHIR bundle", async () => {
    const result = await getLatestOuraSummary(USER_ID, {
      database: fakeDatabase as never,
      cipher: async () => plainCipher,
    });

    expect(recorded.snapshotQueries).toEqual([
      {
        where: { userId: USER_ID },
        orderBy: { syncedAt: "desc" },
        select: { id: true, summary: true },
      },
    ]);
    expect(recorded.snapshotRows.map((row) => Object.keys(row))).toEqual([
      ["id", "summary"],
    ]);
    expect(result).toEqual(STORED_SUMMARY);
    expect(Object.keys(result ?? {})).not.toContain("fhirBundle");
  });
});
