import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cohortInScope,
  type SessionScope,
  SYNTHETIC_COHORTS,
  subjectRowInScope,
} from "./scope";
import {
  DEMO_SUBJECT_WHERE,
  demoSubjectInScope,
  DISPLAY_SUBJECT_WHERE,
  displayCohortInScope,
  displaySubjectInScope,
} from "./synthetic-display";

const ROOT = join(import.meta.dir, "../..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

const synthetic = { isSynthetic: true, cohortId: "synthea-v4-seed42" };
const personal: SessionScope = { actor: "local", sessionId: "s", mode: "personal" };

describe("chat scope in personal mode", () => {
  test("still refuses every synthetic cohort and subject", () => {
    expect(SYNTHETIC_COHORTS.filter((id) => cohortInScope(personal, id))).toEqual([]);
    expect(subjectRowInScope(personal, synthetic)).toBe(false);
    expect(subjectRowInScope({ ...personal, mode: "synthetic" }, synthetic)).toBe(true);
  });

  test("the chat tools never import the display scope", () => {
    const chatFiles = [
      "packages/query-tools/tools.ts",
      "packages/query-tools/ai-tools.ts",
      "packages/query-tools/mcp-server.ts",
      "features/chat/chat-tools.ts",
      "features/chat/show-view-tool.ts",
    ];
    expect(
      chatFiles.filter((path) => source(path).includes("synthetic-display")),
    ).toEqual([]);
  });
});

describe("synthetic display scope", () => {
  test("shows synthetic rows of allowlisted cohorts with no mode at all", () => {
    expect(displayCohortInScope("synthea-v4-seed42")).toBe(true);
    expect(displayCohortInScope("synthea-v4-seed1001")).toBe(true);
    expect(displaySubjectInScope(synthetic)).toBe(true);
    expect(demoSubjectInScope(synthetic)).toBe(true);
  });

  test("never a non-synthetic row, a cohort off the list, or nothing", () => {
    const rows = [
      { isSynthetic: false, cohortId: "synthea-v4-seed42" },
      { isSynthetic: true, cohortId: "someone-elses-cohort" },
      { isSynthetic: false, cohortId: "oura" },
      null,
    ];
    expect(rows.filter(displaySubjectInScope)).toEqual([]);
    expect(rows.filter(demoSubjectInScope)).toEqual([]);
    expect(displayCohortInScope("someone-elses-cohort")).toBe(false);
  });

  test("the Demo never shows a training or held-out subject", () => {
    expect(
      demoSubjectInScope({ isSynthetic: true, cohortId: "synthea-v4-seed4242" }),
    ).toBe(false);
    expect(
      displaySubjectInScope({ isSynthetic: true, cohortId: "synthea-v4-seed4242" }),
    ).toBe(true);
  });

  test("the database filters select only synthetic rows of allowlisted cohorts", () => {
    expect(DISPLAY_SUBJECT_WHERE).toEqual({
      isSynthetic: true,
      cohortId: { in: [...SYNTHETIC_COHORTS] },
    });
    expect(DEMO_SUBJECT_WHERE).toEqual({
      isSynthetic: true,
      cohortId: { in: ["open-twin-synthea-trimmed-3", "synthea-v4-seed42"] },
    });
  });

  test("the display reads do not look at DATA_MODE, so personal mode reads them too", () => {
    const displayFiles = [
      "packages/query-tools/synthetic-display.ts",
      "features/data-explorer/explorer-reads.ts",
      "features/data-explorer/explorer-ports.ts",
      "features/data-explorer/training-files.ts",
      "features/data-explorer/training-file-ports.ts",
      "features/digital-twin/biomarkers/cohort-handler.ts",
      "features/digital-twin/biomarkers/cohort-ports.ts",
    ];
    const readsMode = (text: string) =>
      /DATA_MODE|dataMode|serverEnv|SessionScope/.test(
        text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
      );
    expect(displayFiles.filter((path) => readsMode(source(path)))).toEqual([]);
  });
});
