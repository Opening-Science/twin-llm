import type { CompactThread } from "./compact-draft";

/** A synthetic saved thread for the memory tests: two turns, tool calls with inputs only. */
export const SYNTHETIC_THREAD: CompactThread = {
  id: "thread-synthetic-1",
  title: "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
  turns: [
    {
      id: "turn-1",
      prompt: "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
      answers: [
        {
          modelId: "qwen3:4b",
          modelName: "Qwen3 4B",
          status: "COMPLETE",
          text: "## Reasoning\nRead rows.\n\n## Answer\nHeart rate fell from 78 to 72.5 bpm.\n\n## Uncertainty\nFew readings.",
          tools: [
            {
              tool: "trend",
              state: "done",
              args: [
                { label: "Measure", value: "8867-4" },
                { label: "Window", value: "1 Mar 2026 – 31 May 2026" },
                { label: "Subject", value: "29bbf012" },
              ],
            },
            {
              tool: "baseline_deviation",
              state: "done",
              args: [
                { label: "Measure", value: "8867-4" },
                { label: "Baseline", value: "1 Jan 2026 – 28 Feb 2026" },
                { label: "Target", value: "1 Mar 2026 – 31 May 2026" },
              ],
            },
            {
              tool: "trend",
              state: "refused",
              args: [{ label: "Measure", value: "2339-0" }],
            },
            { tool: "list_subjects", state: "done", args: [] },
          ],
        },
      ],
    },
    {
      id: "turn-2",
      prompt: "And sleep?",
      answers: [
        {
          modelId: "agent:sleep",
          modelName: "Sleep agent",
          status: "FAILED",
          text: "",
        },
        {
          modelId: "qwen3:4b",
          modelName: "Qwen3 4B",
          status: "COMPLETE",
          text: "No sleep rows were found.",
          tools: [
            {
              tool: "summary_stats",
              state: "done",
              args: [{ label: "Measure", value: "93832-4" }],
            },
          ],
        },
      ],
    },
  ],
};
