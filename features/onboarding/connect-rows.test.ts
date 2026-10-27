import { describe, expect, test } from "bun:test";

import { connectGroups, linkedNames, sourceAvailability } from "./connect-rows";

const off = { configured: false, connected: false };

describe("connect rows", () => {
  test("each state gets its word and its real action", () => {
    const groups = connectGroups({
      oura: { configured: true, connected: true },
      whoop: { configured: true, connected: false },
      googleHealth: off,
      bodyloop: { configured: true, connected: false },
      arkEnabled: false,
    });
    const rows = groups.flatMap((group) =>
      group.rows.map((row) => [row.id, row.stateLabel, row.action?.href ?? null]),
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Wearables",
      "Body scan",
      "Genome",
    ]);
    expect(rows).toEqual([
      ["oura", "Linked", null],
      ["whoop", "Not linked", "/api/whoop/authorize"],
      ["google-health", "Not set up", "/connectors?source=google-health"],
      ["bodyloop", "Not linked", "/customize/connectors"],
      ["ark", "Not set up", "/customize/connectors"],
    ]);
    expect(linkedNames(groups)).toEqual(["Oura"]);
  });

  test("nothing is linked when nothing is stored", () => {
    const groups = connectGroups({
      oura: off,
      whoop: off,
      googleHealth: off,
      bodyloop: off,
      arkEnabled: true,
    });
    expect(linkedNames(groups)).toEqual([]);
    expect(groups[2]?.rows[0]?.stateLabel).toBe("Turned on");
  });
});

describe("source availability", () => {
  test("personal mode turns the cohort tools off; empty indexes and GBD say why", () => {
    expect(
      sourceAvailability({
        dataMode: "personal",
        guidelineDocuments: 0,
        knowledgeDocuments: 5,
        gbdConfigured: false,
        genomeChat: false,
      }),
    ).toEqual({
      guidelines: { available: false, note: "Not indexed yet" },
      "opentwin-knowledge": { available: true, note: null },
      "cohort-records": { available: false, note: "Synthetic data mode only" },
      "cohort-analytics": { available: false, note: "Synthetic data mode only" },
      "wearable-analytics": { available: true, note: null },
      gbd: { available: false, note: "Pending IHME's OK" },
      "ark-genome": { available: false, note: "Needs Ark and local Carbon-X" },
    });
  });

  test("synthetic mode with indexes and GBD makes every source but the genome usable", () => {
    const all = sourceAvailability({
      dataMode: "synthetic",
      guidelineDocuments: 12,
      knowledgeDocuments: 5,
      gbdConfigured: true,
      genomeChat: false,
    });
    expect(
      Object.entries(all)
        .filter(([, item]) => !item.available)
        .map(([id]) => id),
    ).toEqual(["ark-genome"]);
  });

  test("the genome source is usable when the genome policy allows chat", () => {
    const all = sourceAvailability({
      dataMode: "personal",
      guidelineDocuments: 0,
      knowledgeDocuments: 0,
      gbdConfigured: false,
      genomeChat: true,
    });
    expect(all["ark-genome"]).toEqual({ available: true, note: null });
  });
});
