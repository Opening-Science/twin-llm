import { describe, expect, test } from "bun:test";

import { displayModelName, friendlyModelName } from "./model-names";

describe("friendlyModelName", () => {
  test("our three fine-tunes", () => {
    expect(
      ["twinllm-qwen3-4b-base", "twinllm-qwen3-4b-pilot", "twinllm-qwen3-4b-pilot1"].map(
        friendlyModelName,
      ),
    ).toEqual(["TwinLLM 4B (base)", "TwinLLM 4B (pilot)", "TwinLLM 4B (pilot 1)"]);
  });

  test("the generic twinllm-<base>-<tag> rule", () => {
    expect(friendlyModelName("twinllm-llama3.2-0.6b-sft2")).toBe("TwinLLM 0.6B (sft 2)");
    expect(friendlyModelName("twinllm-qwen3-14b-dpo_round2")).toBe(
      "TwinLLM 14B (dpo round 2)",
    );
    expect(friendlyModelName("twinllm-mistral-pilot")).toBe("TwinLLM mistral (pilot)");
  });

  test("an Ollama tag other than latest joins the tag; a path is read by its last part", () => {
    expect(friendlyModelName("twinllm-qwen3-4b-pilot:latest")).toBe("TwinLLM 4B (pilot)");
    expect(friendlyModelName("twinllm-qwen3-4b-pilot:q8_0")).toBe(
      "TwinLLM 4B (pilot, q8_0)",
    );
    expect(friendlyModelName("opensci/twinllm-qwen3-4b-base")).toBe("TwinLLM 4B (base)");
  });

  test("any other id keeps its own name", () => {
    expect(
      [
        "qwen3:4b",
        "twinllm",
        "twinllm-",
        "twinllm-qwen3",
        "twinllm--base",
        "my-twinllm-a-b",
      ].map(friendlyModelName),
    ).toEqual([null, null, null, null, null, null]);
    expect(displayModelName("qwen3:8b")).toBe("qwen3:8b");
    expect(displayModelName("twinllm-qwen3-4b-base")).toBe("TwinLLM 4B (base)");
  });
});
