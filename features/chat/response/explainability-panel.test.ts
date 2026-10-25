import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  validateInterpretationDocument,
} from "@open-twin/interpretation-contract";

import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";

import { buildResponseDocumentV1 } from "./build-document";
import { formatContractStateLine } from "./contract-lines";
import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ATTRIBUTION_LINE,
  GUIDELINE_ONLY_BANNER,
  UNVERIFIED_NARRATION,
} from "./copy";
import fixture from "./fixtures/contract-nine-systems.json";

const panelSource = readFileSync(
  join(import.meta.dir, "../../arena/explainability-panel.tsx"),
  "utf8",
);

describe("explainability panel + fixture contract", () => {
  test("pin fixture covers all nine SystemIds and is conformant", () => {
    const result = validateInterpretationDocument(fixture);
    expect(result.ok).toBe(true);
    expect(result.document).toBeDefined();
    const ids = result.document!.states.map((state) => state.system_id);
    expect(ids).toEqual([...SYSTEM_IDS]);
  });

  test("Unverified narration copy and nine compact SystemId rows", () => {
    expect(UNVERIFIED_NARRATION).toBe("Unverified narration");
    expect(ABSTAIN_BANNER).toBe("Not enough data — this reply is withheld.");
    expect(GUIDELINE_ATTRIBUTION_LINE).toBe(
      "Published guideline passage as reference material, not a statement about this person.",
    );
    expect(GUIDELINE_ONLY_BANNER).toBe(
      "Answer drawn from published guidelines only; no data about you was used.",
    );
    // The panel imports the shared copy rather than keeping its own strings.
    expect(panelSource).toContain('from "@/infrastructure/response-document/copy"');
    expect(panelSource).not.toContain(`"${ABSTAIN_BANNER}"`);
    expect(panelSource).not.toContain(`"${GUIDELINE_ATTRIBUTION_LINE}"`);
    expect(panelSource).not.toContain(`"${GUIDELINE_ONLY_BANNER}"`);
    expect(panelSource).not.toContain(`"${DECLINED_BANNER}"`);

    const lines = fixture.states.map((state) =>
      formatContractStateLine({
        system_id: state.system_id,
        severity: state.severity,
      }),
    );
    expect(lines).toHaveLength(9);
    expect(lines).toEqual([
      "musculoskeletal none",
      "cardiovascular borderline",
      "nervous mild",
      "respiratory moderate",
      "metabolic marked",
      "digestive indeterminate",
      "endocrine none",
      "integumentary borderline",
      "reproductive mild",
    ]);

    const document = buildResponseDocumentV1({
      parsed: parseTwinAnswer(
        [
          "## Reasoning",
          "Cite one wearable key.",
          "",
          "## Evidence Used",
          "- [whoop.recovery.score.2026-01-02]",
          "",
          "## Answer",
          "Recovery on 2026-01-02 is 64 in the injected list.",
          "",
          "## Uncertainty",
          "One day is not a trend.",
        ].join("\n"),
        {
          oura: null,
          whoop: {
            window: { startDate: "2026-01-02", endDate: "2026-01-02" },
            narrative: "Synthetic Whoop window.",
            metrics: [
              {
                key: "whoop.recovery.score.2026-01-02",
                label: "Recovery score",
                value: 64,
              },
            ],
          },
          googleHealth: null,
          vitronic: null,
        },
      ),
      toolCalls: [],
      mode: "personal",
    });
    expect(document.interpretation.kind).toBe("narration");
    if (document.interpretation.kind === "narration") {
      expect(document.interpretation.text).toBe(
        "Recovery on 2026-01-02 is 64 in the injected list.",
      );
    }
  });

  test("abstain path uses kind=none (banner copy is locked)", () => {
    const withheld = buildResponseDocumentV1({
      parsed: parseTwinAnswer(
        [
          "## Reasoning",
          "No keys.",
          "",
          "## Evidence Used",
          "- none",
          "",
          "## Answer",
          "Withheld.",
          "",
          "## Uncertainty",
          "Empty window.",
        ].join("\n"),
        { oura: null, whoop: null, googleHealth: null, vitronic: null },
      ),
      toolCalls: [],
      mode: "personal",
    });
    expect(withheld.interpretation.kind).toBe("none");
    expect(withheld.abstained).toBe(true);
    expect(ABSTAIN_BANNER).toBe("Not enough data — this reply is withheld.");
  });
});
