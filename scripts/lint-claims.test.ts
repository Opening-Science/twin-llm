import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { lintClaims, scanClaims } from "./lint-claims";

const writeFixture = (bannedLine: string): string => {
  const root = mkdtempSync(join(tmpdir(), "lint-claims-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "fixture.md"), `${bannedLine}\n`);
  writeFileSync(join(root, "README.md"), "TwinLLM research-use visualisation.\n");
  return root;
};

describe("lintClaims", () => {
  test("packages/biomarkers strings are scanned, its tests are not", () => {
    const root = writeFixture("Plain copy.");
    mkdirSync(join(root, "packages", "biomarkers"), { recursive: true });
    writeFileSync(
      join(root, "packages", "biomarkers", "notes.ts"),
      'export const NOTE = "A symptom map";\n',
    );
    writeFileSync(
      join(root, "packages", "biomarkers", "notes.test.ts"),
      'const NOTE = "A symptom map";\n',
    );
    expect(lintClaims({ root, allowlist: [] })).toEqual([
      { file: "packages/biomarkers/notes.ts", line: 1, term: "symptom" },
    ]);
  });

  test("knowledge/ markdown is scanned like docs/", () => {
    const root = writeFixture("Plain line.");
    mkdirSync(join(root, "knowledge", "opentwin"), { recursive: true });
    writeFileSync(
      join(root, "knowledge", "opentwin", "note.md"),
      "HRV is not a symptom score.\n",
    );
    expect(lintClaims({ root, allowlist: [] })).toEqual([
      { file: "knowledge/opentwin/note.md", line: 1, term: "symptom" },
    ]);
  });

  test("a fixture file with a banned term fails", () => {
    const root = writeFixture("This copy will diagnose a condition.");
    const hits = lintClaims({ root, allowlist: [] });
    expect(hits).toEqual([{ file: "docs/fixture.md", line: 1, term: "diagnos" }]);
  });

  test("the same file with an allowlist entry passes", () => {
    const root = writeFixture("This copy will diagnose a condition.");
    const hits = lintClaims({
      root,
      allowlist: [
        {
          file: "docs/fixture.md",
          "line-pattern": "diagnose a condition",
          reason: "synthetic fixture",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  test("allowlisted hits carry the reason", () => {
    const root = writeFixture("This copy will diagnose a condition.");
    const report = scanClaims({
      root,
      allowlist: [
        {
          file: "docs/fixture.md",
          "line-pattern": "diagnose a condition",
          reason: "synthetic fixture",
        },
      ],
    });
    expect(report.findings).toEqual([]);
    expect(report.allowlisted).toEqual([
      {
        file: "docs/fixture.md",
        line: 1,
        term: "diagnos",
        reason: "synthetic fixture",
      },
    ]);
  });
});
