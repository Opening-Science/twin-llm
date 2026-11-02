import { describe, expect, test } from "bun:test";

import type { ResponseState } from "./conversation";
import { exportFileName, threadMarkdown } from "./thread-markdown";
import { threadPrintHtml } from "./thread-print";

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

  test("a GBD profile keeps the app's header and footer in Markdown and print (#417)", () => {
    const frame = {
      title: "Location profile: Switzerland, 2023",
      source: "IHME GBD 2023",
      importedOn: "2026-11-01",
      attribution:
        "Population estimate (IHME GBD 2023), not a statement about this person.",
      citation: "A made-up citation. Available from https://example.org/.",
    };
    const markdown = threadMarkdown(
      {
        title: "/profile Switzerland",
        turns: [
          {
            id: "t1",
            prompt: "/profile Switzerland",
            answers: [
              answer({ text: "HALE is higher than the region's.", profileFrame: frame }),
            ],
          },
        ],
      },
      "2 Nov 2026",
    );
    expect(markdown).toContain(
      [
        "### qwen3:4b",
        "",
        "**Location profile: Switzerland, 2023**",
        "",
        "_Source: IHME GBD 2023, imported 2026-11-01._",
        "",
        "HALE is higher than the region's.",
        "",
        "_Population estimate (IHME GBD 2023), not a statement about this person._",
        "",
        "Citation: A made-up citation. Available from https://example.org/.",
      ].join("\n"),
    );
    const html = threadPrintHtml(markdown, "Profile");
    expect(html).toContain("<p><strong>Location profile: Switzerland, 2023</strong></p>");
    expect(html).toContain("<p><em>Source: IHME GBD 2023, imported 2026-11-01.</em></p>");
    expect(html).toContain(
      "<p><em>Population estimate (IHME GBD 2023), not a statement about this person.</em></p>",
    );
    expect(html).toContain("<p>Citation: A made-up citation.");
  });

  test("a withheld or failed profile answer has no frame", () => {
    const frame = {
      title: "Cause profile: Neoplasms",
      source: "IHME GBD 2023",
      importedOn: null,
      attribution: "Attribution.",
      citation: "Citation.",
    };
    const markdown = threadMarkdown(
      {
        title: "t",
        turns: [
          {
            id: "t1",
            prompt: "p",
            answers: [
              answer({ status: "FAILED", refusal: "No.", profileFrame: frame }),
              answer({
                text: "x",
                profileFrame: frame,
                document: { abstained: true } as ResponseState["document"],
              }),
            ],
          },
        ],
      },
      "2 Nov 2026",
    );
    expect(markdown).not.toContain("Cause profile");
    expect(markdown).not.toContain("Citation.");
  });

  test("file names come from the readable title", () => {
    expect(exportFileName(`For subject_ref ${REF}: what is the latest HbA1c?`)).toBe(
      "what-is-the-latest-hba1c-subject-085b5e.md",
    );
    expect(exportFileName("???")).toBe("thread.md");
    expect(
      exportFileName(
        `For synthetic subject ${REF}, how has their heart rate changed across their records?`,
      ),
    ).toBe("how-has-their-heart-rate-changed-across-their-records.md");
  });
});
