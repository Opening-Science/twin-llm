import { describe, expect, test } from "bun:test";

import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import { buildResponseDocumentV1 } from "@/features/chat/response/build-document";
import type { ResponseToolCall } from "@/features/chat/response/document-v1";
import type { GuidelineCitation } from "@/packages/guidelines/collector";

import cases from "./cases.json";

type ExpectClass = "CITE" | "ABSTAIN" | "REFUSE";

type GuidelineCase = {
  readonly id: string;
  readonly expect: ExpectClass;
  readonly completion: string;
  readonly toolCalls: readonly ResponseToolCall[];
  readonly guidelineSources: readonly GuidelineCitation[];
};

const emptySummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const documentOf = (item: GuidelineCase) =>
  buildResponseDocumentV1({
    parsed: parseTwinAnswer(item.completion, emptySummaries),
    toolCalls: item.toolCalls,
    mode: "personal",
    guidelineSources: item.guidelineSources,
  });

describe("guideline eval cases (canned document)", () => {
  const list = cases as GuidelineCase[];
  const cites = list.filter((item) => item.expect === "CITE");
  const refusals = list.filter(
    (item) => item.expect === "ABSTAIN" || item.expect === "REFUSE",
  );

  test("case file has CITE and a person-application refusal", () => {
    expect(cites.length).toBeGreaterThanOrEqual(2);
    expect(refusals.length).toBeGreaterThanOrEqual(1);
  });

  for (const item of list) {
    test(`${item.id} is ${item.expect}`, () => {
      if (item.expect === "REFUSE" || item.expect === "ABSTAIN") {
        expect(item.completion.startsWith(item.expect)).toBe(true);
        return;
      }

      const document = documentOf(item);
      expect(document.data_basis.sources.guidelines.length).toBeGreaterThan(0);
      expect(JSON.stringify(document.data_basis.sources.guidelines)).not.toContain(
        "passage",
      );
      expect(document.abstained).toBe(false);
      const personal = document.data_basis.evidence_keys.length > 0;
      if (personal) {
        expect(document.sufficient_data).toBe(true);
        expect(document.interpretation.kind).toBe("narration");
      } else {
        expect(document.sufficient_data).toBe(false);
        expect(document.interpretation).toEqual({ kind: "none" });
      }
    });
  }
});

describe("guideline eval live path", () => {
  test("GUIDELINE_EVAL is unset in this suite", () => {
    expect(Reflect.get(process.env, "GUIDELINE_EVAL")).toBeUndefined();
  });

  test("GUIDELINE_EVAL=1 is a local-only hook", async () => {
    if (Reflect.get(process.env, "GUIDELINE_EVAL") !== "1") return;
    const { runGuidelineSearch } = await import("@/packages/guidelines/search");
    expect(typeof runGuidelineSearch).toBe("function");
  });
});
