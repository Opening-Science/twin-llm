import { describe, expect, test } from "bun:test";

import { openChatText, sealChatText, sealContextOf } from "./chat-seal-contexts";
import { FieldDecryptError } from "./field-crypto";
import { plainCipher, sealedCipher } from "./field-cipher";
import { openPrompt, openThreadTitle, RESPONSES } from "./thread-fields";

const cipher = sealedCipher({ keyId: "00112233445566aa", dataKey: Buffer.alloc(32, 3) });

const problemOf = (open: () => string): string => {
  try {
    open();
    return "opened";
  } catch (error) {
    return error instanceof FieldDecryptError ? error.problem : "other";
  }
};

describe("chat seal contexts", () => {
  test("a title sealed in threads opens from conversations with the same id", () => {
    const stored = cipher.sealText("threads", "title", "c1", "Made-up title");
    expect(openChatText(cipher, "conversations", "title_sealed", "c1", stored)).toBe(
      "Made-up title",
    );
  });

  test("every answer column opens under its old column name", () => {
    for (const [column, old] of [
      ["body_sealed", "text"],
      ["reasoning_sealed", "reasoningText"],
      ["evidence_sealed", "attribution"],
      ["document_sealed", "responseDocument"],
      ["tool_trace_sealed", "toolParts"],
    ] as const) {
      const stored = cipher.sealText(RESPONSES, old, "a1", `made-up ${old}`);
      expect(openChatText(cipher, "answers", column, "a1", stored)).toBe(
        `made-up ${old}`,
      );
    }
  });

  test("a value sealed for the new tables opens through today's readers", () => {
    const title = sealChatText(cipher, "conversations", "title_sealed", "c2", "Made-up");
    expect(openThreadTitle(cipher, "c2", title)).toBe("Made-up");
    const question = sealChatText(
      cipher,
      "exchanges",
      "question_sealed",
      "e2",
      "Made-up?",
    );
    expect(openPrompt(cipher, "e2", question)).toBe("Made-up?");
  });

  test("the row id still binds the value: another row's id does not open it", () => {
    const stored = cipher.sealText("turns", "prompt", "e3", "Made-up?");
    expect(
      problemOf(() => openChatText(cipher, "exchanges", "question_sealed", "e4", stored)),
    ).toBe("authentication");
    expect(
      problemOf(() =>
        openChatText(cipher, "exchanges", "bubble_text_sealed", "e3", stored),
      ),
    ).toBe("authentication");
  });

  test("a context named at run time is found only for a real sealed column", () => {
    expect(sealContextOf("answers", "tool_trace_sealed")).toEqual({
      table: "model_responses",
      column: "toolParts",
    });
    expect(sealContextOf("answers", "cost_usd")).toBeNull();
    expect(sealContextOf("answers", "constructor")).toBeNull();
    expect(sealContextOf("toString", "title_sealed")).toBeNull();
    expect(sealContextOf("threads", "title")).toBeNull();
  });

  test("a synthetic install's plain values pass through unchanged", () => {
    expect(openChatText(plainCipher, "answers", "body_sealed", "a5", "plain text")).toBe(
      "plain text",
    );
  });
});
