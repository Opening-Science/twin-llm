import { describe, expect, test } from "bun:test";

import { spokenChunks, spokenText } from "./spoken-text";

describe("spokenText", () => {
  test("keeps the words and drops what only works on screen", () => {
    const answer = [
      "## Your heart",
      "",
      "Your **resting heart rate** was 58 bpm on 3 March [S1], within the usual range [G2].",
      "",
      "- Lowest at night",
      "- Highest after the walk",
      "",
      "| Day | bpm |",
      "| --- | --- |",
      "| Mon | 58 |",
      "",
      "See the [guideline](https://example.org/g) or https://example.org/raw.",
      "![chart](images/x.png)",
      "```",
      "select * from rows",
      "```",
    ].join("\n");
    expect(spokenText(answer, "en")).toBe(
      "Your heart. Your resting heart rate was 58 beats per minute on 3 March, within the usual range. Lowest at night. Highest after the walk. See the guideline or.",
    );
  });

  test("German stays as it is", () => {
    expect(spokenText("Dein Puls lag bei _58 Schlägen_ pro Minute.", "de")).toBe(
      "Dein Puls lag bei 58 Schlägen pro Minute.",
    );
  });

  test("an empty answer has nothing to say", () => {
    expect(spokenText("```\ncode\n```\n| a |", "en")).toBe("");
  });
});

describe("spokenChunks", () => {
  test("packs whole sentences up to the limit", () => {
    expect(spokenChunks("One two. Three four! Five six? Seven.", 20)).toEqual([
      "One two. Three four!",
      "Five six? Seven.",
    ]);
  });

  test("cuts a sentence longer than the limit at a space", () => {
    expect(spokenChunks("aaaa bbbb cccc dddd.", 10)).toEqual(["aaaa bbbb", "cccc dddd."]);
  });

  test("never above the sidecar's limit", () => {
    const long = `${"word ".repeat(1000).trim()}.`;
    expect(spokenChunks(long, 5000).every((chunk) => chunk.length <= 2000)).toBe(true);
  });

  test("nothing to say, no pieces", () => {
    expect(spokenChunks("   ")).toEqual([]);
  });
});
