import { describe, expect, test } from "bun:test";

import { splitThinking } from "./think-block";

describe("splitThinking", () => {
  test("a reply with only the closing tag loses everything before it", () => {
    expect(
      splitThinking("Okay, let's see. The tool said…\n</think>\n\n## Reasoning\nr"),
    ).toEqual({
      thinking: "Okay, let's see. The tool said…",
      text: "## Reasoning\nr",
    });
  });

  test("a full block is taken out the same way", () => {
    expect(splitThinking("<think>hmm</think>## Answer\n72 bpm")).toEqual({
      thinking: "hmm",
      text: "## Answer\n72 bpm",
    });
  });

  test("an empty block leaves no thinking", () => {
    expect(splitThinking("<think>\n\n</think>\n\n## Answer\nx")).toEqual({
      thinking: null,
      text: "## Answer\nx",
    });
  });

  test("an open block mid-stream shows nothing yet", () => {
    expect(splitThinking("<think>first I will")).toEqual({
      thinking: "first I will",
      text: "",
    });
  });

  test("a reply with no tags is untouched, even one that mentions thinking", () => {
    const text = "## Answer\nI think the trend is flat.";
    expect(splitThinking(text)).toEqual({ thinking: null, text });
  });
});
