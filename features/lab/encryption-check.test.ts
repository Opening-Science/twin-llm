import { describe, expect, test } from "bun:test";

import { encryptionCheck } from "./encryption-check";

describe("Encryption at rest card (#141)", () => {
  test("personal mode with nothing plain is OK", () => {
    const card = encryptionCheck({ dataMode: "personal", findings: [] });
    expect(card.status).toBe("ok");
    expect(card.table?.rows).toEqual([]);
    expect(card.howTo).toContain("bun run doctor");
  });

  test("plain values are Not OK, with table, column and count only", () => {
    const card = encryptionCheck({
      dataMode: "personal",
      findings: [{ table: "personal_observations", column: "display", rows: 3 }],
    });
    expect(card.status).toBe("not-ok");
    expect(card.summary).toContain("bun run vault:migrate");
    expect(card.table?.rows).toEqual([
      ["personal_observations", "display", "3", "Not OK"],
    ]);
  });

  test("synthetic mode has nothing to encrypt and never says OK", () => {
    expect(encryptionCheck({ dataMode: "synthetic", findings: [] }).status).toBe(
      "unknown",
    );
  });
});
