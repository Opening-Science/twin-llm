import { describe, expect, test } from "bun:test";

import { plainCipher, sealedCipher, sealJson } from "./field-cipher";
import { openPrompt, openResponse, openThreadTitle } from "./thread-fields";

const cipher = sealedCipher({ keyId: "0123456789abcdef", dataKey: Buffer.alloc(32, 4) });

describe("opening thread columns (#141)", () => {
  test("opens only the selected columns and parses the JSON ones", () => {
    const id = "response-1";
    const row = {
      id,
      modelId: "synthetic-model",
      text: cipher.sealText(
        "model_responses",
        "text",
        id,
        "An answer about synthetic data.",
      ),
      reasoningText: null,
      toolParts: sealJson(cipher, "model_responses", "toolParts", id, [
        { tool: "coverage" },
      ]),
    };
    expect(openResponse(cipher, row)).toEqual({
      id,
      modelId: "synthetic-model",
      text: "An answer about synthetic data.",
      reasoningText: null,
      toolParts: [{ tool: "coverage" }],
    });
    expect(openResponse(cipher, { id, attribution: null })).toEqual({
      id,
      attribution: null,
    });
  });

  test("titles and prompts are bound to their row", () => {
    const title = cipher.sealText("threads", "title", "thread-1", "Sleep this week");
    expect(openThreadTitle(cipher, "thread-1", title)).toBe("Sleep this week");
    expect(() => openThreadTitle(cipher, "thread-2", title)).toThrow();
    const prompt = cipher.sealText("turns", "prompt", "turn-1", "How did I sleep?");
    expect(openPrompt(cipher, "turn-1", prompt)).toBe("How did I sleep?");
  });

  test("a synthetic install reads its plain rows", () => {
    expect(
      openResponse(plainCipher, { id: "r", text: "plain", attribution: "[]" }),
    ).toEqual({
      id: "r",
      text: "plain",
      attribution: [],
    });
  });
});
