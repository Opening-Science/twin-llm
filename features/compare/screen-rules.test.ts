import { describe, expect, test } from "bun:test";

import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import type { TurnState } from "./conversation";
import {
  displayText,
  lastTurnEffort,
  lastTurnModelIds,
  nextGeneration,
  pageHeading,
  showThreadAddress,
} from "./screen-rules";

describe("the address after a first send (review of #596)", () => {
  test("replaces the entry with no state, so the router syncs and the thread bar renders", () => {
    const calls: unknown[][] = [];
    showThreadAddress("thread-synthetic-1", {
      replaceState: (...args: unknown[]) => {
        calls.push(args);
      },
    });
    expect(calls).toEqual([[null, "", "/t/thread-synthetic-1"]]);
  });
});

/** Screen-level rules from SPEC 3.2, 7.2, 7.9 and 11, with synthetic turns. */

const turn = (over: Partial<TurnState> = {}): TurnState => ({
  id: "turn-1",
  prompt:
    "For synthetic subject 29bbf012, using LOINC 8867-4, how did heart rate change?",
  answers: [
    {
      id: "row-1",
      modelId: "agent:auto",
      modelName: "Auto → Heart",
      status: "COMPLETE",
      text: "",
      metrics: null,
    },
    {
      id: "row-2",
      modelId: "qwen3:4b",
      modelName: "Qwen3 4B",
      status: "COMPLETE",
      text: "",
      metrics: null,
    },
  ],
  ...over,
});

describe("headings and bubbles", () => {
  test("the bubble shows a chip's short text, else the prompt", () => {
    expect(displayText(turn({ label: "How did their heart rate change?" }))).toBe(
      "How did their heart rate change?",
    );
    expect(displayText(turn())).toContain("LOINC 8867-4");
  });

  test("the hidden page heading is the first turn's display text, or TwinLLM", () => {
    expect(pageHeading([])).toBe("TwinLLM");
    expect(
      pageHeading([turn({ label: "Short" }), turn({ id: "t2", label: "Later" })]),
    ).toBe("Short");
  });
});

describe("a reopened thread carries on (SPEC 7.2)", () => {
  test("from the last turn's answer ids", () => {
    expect(lastTurnModelIds([])).toBeNull();
    expect(lastTurnModelIds([turn()])).toEqual(["agent:auto", "qwen3:4b"]);
  });

  test("at the last turn's effort: sent with it in this tab, else its stored documents, else Balanced", () => {
    expect(lastTurnEffort([])).toBe("balanced");
    expect(lastTurnEffort([turn({ effort: "deep" })])).toBe("deep");
    const document = {
      effort: { level: "ultra", thinking: "on", max_steps: 12, review: true },
    } as unknown as ResponseDocumentV1;
    const stored = turn();
    expect(
      lastTurnEffort([{ ...stored, answers: [{ ...stored.answers[0]!, document }] }]),
    ).toBe("ultra");
    expect(lastTurnEffort([turn()])).toBe("balanced");
  });
});

describe("New chat resets (SPEC 7.9)", () => {
  test("arriving at / from any other path is a new generation", () => {
    expect(nextGeneration(0, "/t/thread-1", "/")).toBe(1);
    expect(nextGeneration(3, "/customize", "/")).toBe(4);
  });

  test("the first send moving the address to /t/<id> is not", () => {
    expect(nextGeneration(0, "/", "/t/thread-1")).toBe(0);
    expect(nextGeneration(2, "/", "/")).toBe(2);
  });
});
