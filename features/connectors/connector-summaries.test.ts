import { describe, expect, test } from "bun:test";

import type { PersonalRead } from "@/infrastructure/personal-read-audit";

import { readConnectorSummaries, type ConnectorSummaryDeps } from "./connector-summaries";

const SUMMARY = { narrative: "Synthetic wearable context." };

const deps = (
  rows: PersonalRead[],
  personal: boolean,
): ConnectorSummaryDeps<typeof SUMMARY, typeof SUMMARY, typeof SUMMARY> => ({
  isPersonalMode: () => personal,
  getLatestOuraSummary: async () => SUMMARY,
  getLatestWhoopSummary: async () => null,
  getLatestGoogleHealthSummary: async () => SUMMARY,
  auditPersonalRead: async (read) => {
    rows.push(read);
  },
});

describe("readConnectorSummaries", () => {
  test("personal mode writes one row counting the summaries found", async () => {
    const rows: PersonalRead[] = [];
    const result = await readConnectorSummaries(
      deps(rows, true),
      "user_synthetic_1",
      "app-user-1",
    );

    expect(result).toEqual({
      ouraSummary: SUMMARY,
      whoopSummary: null,
      googleHealthSummary: SUMMARY,
    });
    expect(rows).toEqual([
      { actor: "user_synthetic_1", purpose: "connectors-page", rowCount: 2 },
    ]);
    expect(JSON.stringify(rows)).not.toContain(SUMMARY.narrative);
  });

  test("synthetic mode writes no row", async () => {
    const rows: PersonalRead[] = [];
    await readConnectorSummaries(deps(rows, false), "user_synthetic_1", "app-user-1");
    expect(rows).toEqual([]);
  });

  test("a failed row rejects, so the summaries are not shown", async () => {
    const run = readConnectorSummaries(
      {
        ...deps([], true),
        auditPersonalRead: async () => {
          throw new Error("audit down");
        },
      },
      "user_synthetic_1",
      "app-user-1",
    );
    await expect(run).rejects.toThrow("audit down");
  });
});
