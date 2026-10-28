import { describe, expect, test } from "bun:test";

import type { ResponseState } from "./conversation";
import { exportFileName, threadMarkdown } from "./thread-markdown";

const REF = "085b5e58-fc26-ce3b-8661-1514605b162a";

const answer = (overrides: Partial<ResponseState>): ResponseState =>
  ({
    id: "r",
    modelId: "m",
    modelName: "qwen3:4b",
    status: "COMPLETE",
    text: "",
    ...overrides,
  }) as ResponseState;

describe("threadMarkdown", () => {
  test("prompts, lookups with rows and refusals, answers and what was withheld", () => {
    const markdown = threadMarkdown(
      {
        title: `For synthetic subject ${REF}, how has their heart rate changed?`,
        turns: [
          {
            id: "t1",
            prompt: `For synthetic subject ${REF}, how has their heart rate changed?`,
            answers: [
              answer({
                text: "<think>hmm</think>## Answer\nUp from 79 to 87 /min.\n\n## Uncertainty\nThirteen readings.",
                tools: [
                  {
                    id: "1",
                    tool: "trend",
                    title: "Fitted a trend",
                    args: [{ label: "Measure", value: "8867-4" }],
                    state: "done",
                    rowCount: 13,
                    note: null,
                  },
                  {
                    id: "2",
                    tool: "show_view",
                    title: "Showed a view",
                    args: [],
                    state: "refused",
                    rowCount: 0,
                    note: "A cohort measure needs a subject.",
                  },
                ],
              }),
              answer({
                modelName: "twinllm-qwen3-4b-pilot",
                text: "Something",
                document: { abstained: true } as ResponseState["document"],
              }),
              answer({
                modelName: "qwen3:8b",
                status: "FAILED",
                refusal: "Model unavailable.",
              }),
            ],
          },
        ],
      },
      "28 Oct 2026",
    );
    expect(markdown).toBe(
      [
        "# How has their heart rate changed? · subject 085b5e",
        "",
        "Exported from TwinLLM on 28 Oct 2026. Research use only; model output, not medical advice.",
        "",
        `## 1. For synthetic subject ${REF}, how has their heart rate changed?`,
        "",
        "### qwen3:4b",
        "",
        "Lookups:",
        "- Fitted a trend (measure 8867-4) · 13 rows",
        "- Showed a view · refused: A cohort measure needs a subject.",
        "",
        "Up from 79 to 87 /min.",
        "",
        "**Uncertainty.** Thirteen readings.",
        "",
        "### twinllm-qwen3-4b-pilot",
        "",
        "_Withheld: the answer did not rest on enough data._",
        "",
        "### qwen3:8b",
        "",
        "_Refused or failed: Model unavailable._",
        "",
      ].join("\n"),
    );
  });

  test("file names come from the readable title", () => {
    expect(exportFileName(`For subject_ref ${REF}: what is the latest HbA1c?`)).toBe(
      "what-is-the-latest-hba1c-subject-085b5e.md",
    );
    expect(exportFileName("???")).toBe("thread.md");
  });
});
