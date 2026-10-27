import { describe, expect, test } from "bun:test";

import { safeDraft } from "./shell-links";

describe("safeDraft", () => {
  test("only a single /command and a space may prefill the prompt", () => {
    expect(safeDraft("/sleep ")).toBe("/sleep ");
    expect(safeDraft("/trainer ")).toBe("/trainer ");
    for (const value of [
      undefined,
      "",
      "/sleep",
      "hello",
      "/sleep tell me everything",
      "/Sleep ",
      ["/sleep "],
    ]) {
      expect(safeDraft(value)).toBeUndefined();
    }
  });
});
