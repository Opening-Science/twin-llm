import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { MAP_REFUSAL_CODES, SHOW_VIEW_REFUSAL_CODES } from "@/infrastructure/chat-view";
import {
  GENOME_NOT_PERMITTED,
  IMPORTED_DATA_NOT_PERMITTED,
} from "@/infrastructure/data-mode-policy";
import { LIVE_REFUSALS, queryRefusal } from "@/packages/live-sources/refusals";
import { GBD_REFUSAL_CODES } from "@/packages/query-tools/gbd-refusals";
import { IMPORTED_REFUSAL_CODES } from "@/packages/query-tools/imported-refusals";

import { toolCard } from "./tool-cards";
import {
  GENERIC_CODE_SENTENCE,
  SENTENCE_CODES,
  toolCodeSentence,
} from "./tool-code-sentences";
import { toolStepLabel } from "./tool-steps";

const ROOT = join(import.meta.dir, "../..");

/** Where the tools build their results; a code written in any of them is one a step can show. */
const TOOL_DIRS = [
  "packages/query-tools",
  "packages/query-tools/event-rates",
  "packages/genome-reference",
  "packages/carbon-x",
  "packages/live-sources",
];
const TOOL_FILES = [
  "features/chat/show-view-tool.ts",
  "features/chat/map-view.ts",
  "features/chat/view-tools.ts",
  "features/chat/genome-tools.ts",
  "features/chat/gbd-profile-tool.ts",
];

const sources = (): string[] => [
  ...TOOL_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(dir, name)),
  ),
  ...TOOL_FILES,
];

const CODE = /"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g;

/** `code: "NO_ROWS"`, `code: x ? "A" : "B"` and `refusal("NO_CALL", ...)`. */
const codesIn = (text: string): string[] => [
  ...[...text.matchAll(/\bcode:[^\n]*/g)].flatMap((line) =>
    [...line[0].matchAll(CODE)].map((match) => match[1] ?? ""),
  ),
  ...[...text.matchAll(/\brefusal\(\s*"([A-Z][A-Z0-9_]+)"/g)].map(
    (match) => match[1] ?? "",
  ),
];

const knownCodes = (): string[] =>
  [
    ...new Set([
      ...sources().flatMap((file) => codesIn(readFileSync(join(ROOT, file), "utf8"))),
      ...SHOW_VIEW_REFUSAL_CODES,
      ...MAP_REFUSAL_CODES,
      ...GBD_REFUSAL_CODES,
      ...IMPORTED_REFUSAL_CODES,
      GENOME_NOT_PERMITTED,
      IMPORTED_DATA_NOT_PERMITTED,
      ...Object.values(LIVE_REFUSALS).map((refusal) => refusal.code),
      queryRefusal("length").code,
    ]),
  ].sort();

describe("every tool code reads as a plain sentence (#529)", () => {
  test("the scan finds the codes the tools return", () => {
    const codes = knownCodes();
    for (const code of ["NO_ROWS", "VIEW_NOT_ALLOWED", "NO_CALL", "CARBON_X_TIMEOUT"]) {
      expect(codes).toContain(code);
    }
  });

  test("each known code has its own sentence", () => {
    const missing = knownCodes().filter((code) => !SENTENCE_CODES.includes(code));
    expect(missing).toEqual([]);
  });

  test("no sentence carries a code, a tool name or a developer word", () => {
    const sentences = SENTENCE_CODES.map((code) => toolCodeSentence("trend", code));
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/[A-Z]{2,}_|_[a-z]/);
      expect(sentence).not.toMatch(
        /\b(warehouse|sql|env|tool|sidecar|loinc|carbon-x|gbd|query|database row)\b/i,
      );
      expect(sentence).not.toMatch(/\.$/);
    }
  });

  test("an unknown code reads the generic sentence", () => {
    expect(toolCodeSentence("trend", "SOMETHING_NEW")).toBe(GENERIC_CODE_SENTENCE);
  });

  test("a step that lists records says records", () => {
    expect(toolCodeSentence("conditions_timeline", "NO_ROWS")).toBe(
      "No recorded condition in this range",
    );
    expect(toolCodeSentence("trend", "NO_ROWS")).toBe("No readings in this range");
  });
});

describe("the step title is the sentence; the code stays on the card", () => {
  const refused = (tool: string, code: string) =>
    toolCard({
      toolCallId: "c1",
      tool,
      state: "output-available",
      input: { measure: "8867-4" },
      output: { code, error: "synthetic" },
    });

  test("NO_ROWS and VIEW_NOT_ALLOWED", () => {
    const empty = refused("trend", "NO_ROWS");
    const gated = refused("show_view", "VIEW_NOT_ALLOWED");
    expect(toolStepLabel(empty)).toBe("No readings in this range");
    expect(toolStepLabel(gated)).toBe("This view isn't allowed for this question");
    expect([empty.refusalCode, gated.refusalCode]).toEqual([
      "NO_ROWS",
      "VIEW_NOT_ALLOWED",
    ]);
  });

  test("a code with no sentence gets the generic one, never the code", () => {
    const card = refused("trend", "SOMETHING_NEW");
    expect(toolStepLabel(card)).toBe(GENERIC_CODE_SENTENCE);
    expect(card.refusalCode).toBe("SOMETHING_NEW");
  });
});
