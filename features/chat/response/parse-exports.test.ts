import { describe, expect, test } from "bun:test";

import {
  citedKeysForDataBasis,
  hasSufficientCitedKeys,
  parseTwinAnswer,
} from "@/infrastructure/parse-twin-answer";

describe("parseTwinAnswer additive exports", () => {
  test("citedKeysForDataBasis drops literal none", () => {
    expect(citedKeysForDataBasis(["none"])).toEqual([]);
    expect(citedKeysForDataBasis(["oura.sleep.score", "none"])).toEqual([
      "oura.sleep.score",
    ]);
    expect(hasSufficientCitedKeys(["none"])).toBe(false);
    expect(hasSufficientCitedKeys(["oura.sleep.score"])).toBe(true);
  });

  test("four-section parse return shape (v1.1 adds declined and offeredKeyCount)", () => {
    const parsed = parseTwinAnswer(
      [
        "## Reasoning",
        "Step.",
        "",
        "## Evidence Used",
        "- [oura.sleep.score]",
        "",
        "## Answer",
        "Body.",
        "",
        "## Uncertainty",
        "Caveat.",
      ].join("\n"),
      { oura: null, whoop: null, googleHealth: null, vitronic: null },
    );
    expect(Object.keys(parsed).sort()).toEqual([
      "answerText",
      "attribution",
      "citedKeys",
      "declined",
      "evidenceKeys",
      "hallucinatedKeys",
      "offeredKeyCount",
      "reasoningText",
      "uncertaintyText",
    ]);
    expect(parsed.reasoningText).toBe("Step.");
    expect(parsed.answerText).toBe("Body.");
    expect(parsed.uncertaintyText).toBe("Caveat.");
    expect(parsed.citedKeys).toEqual(["oura.sleep.score"]);
    expect(parsed.evidenceKeys).toEqual([]);
    expect(parsed.hallucinatedKeys).toEqual(["oura.sleep.score"]);
    expect(parsed.attribution).toEqual([]);
    expect(parsed.declined).toBe(false);
    expect(parsed.offeredKeyCount).toBe(0);
  });
});
