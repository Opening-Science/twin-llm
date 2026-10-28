import { describe, expect, test } from "bun:test";

import { currentPrompt } from "./chat-request";

describe("currentPrompt", () => {
  test("the last user message, skipping a trailing answer", () => {
    expect(
      currentPrompt([
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" },
      ]),
    ).toBe("second");
    expect(
      currentPrompt([
        { role: "user", content: "only" },
        { role: "assistant", content: "answer" },
      ]),
    ).toBe("only");
    expect(currentPrompt([])).toBe("");
  });
});
