import { describe, expect, test } from "bun:test";

import { encryptionSection } from "./encryption-probe";

describe("doctor: Encryption at rest (#141)", () => {
  test("personal mode lists plain columns and leftover backups", () => {
    const lines = encryptionSection({
      dataMode: "personal",
      findings: [{ table: "turns", column: "prompt", rows: 4 }],
      backups: ["pre-encryption-2026-10-31T120000Z.dump"],
    }).join("\n");
    expect(lines).toContain("turns.prompt: 4 row(s) not sealed");
    expect(lines).toContain("pre-encryption-2026-10-31T120000Z.dump holds plain data");
  });

  test("an unanswered database is Unknown, never OK", () => {
    expect(
      encryptionSection({ dataMode: "personal", findings: null, backups: [] }).join("\n"),
    ).toContain("Unknown");
  });

  test("synthetic mode says why nothing is sealed", () => {
    expect(
      encryptionSection({ dataMode: "synthetic", findings: [], backups: [] })[0],
    ).toContain("synthetic rows stay plain");
  });
});
