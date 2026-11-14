import { describe, expect, test } from "bun:test";

import type { ChatView } from "@/infrastructure/chat-view";

import type { AnswerState, TurnState } from "./conversation";
import {
  OUTPUTS_STORAGE_KEY,
  outputEntriesOf,
  readOutputsMode,
  reopenLabel,
  saveOutputsMode,
} from "./outputs-panel-model";

const view = (id: string): ChatView => ({
  id,
  kind: "chart.timeseries",
  title: `Synthetic ${id}`,
  spec: {
    measure: "8867-4",
    label: "Heart rate",
    unit: "/min",
    window: { start: "2026-01-01", end: "2026-01-31" },
    subject: "synthetic-1",
    points: [],
  },
  sourceAuditIds: [id],
});

const answer = (id: string, views: readonly ChatView[]): AnswerState => ({
  id,
  modelId: "qwen3:4b",
  modelName: "Qwen3 4B",
  status: "COMPLETE",
  text: "",
  views,
  metrics: null,
});

const turn = (id: string, answers: readonly AnswerState[]): TurnState => ({
  id,
  prompt: "Synthetic question",
  answers,
});

describe("the Outputs panel's list", () => {
  test("every view of the thread, newest first, once per view id", () => {
    const entries = outputEntriesOf([
      turn("t1", [answer("a1", [view("v1"), view("v2")]), answer("a2", [view("v1")])]),
      turn("t2", [answer("a3", [view("v3")])]),
    ]);
    expect(entries.map((entry) => [entry.answerId, entry.view.id])).toEqual([
      ["a3", "v3"],
      ["a1", "v2"],
      ["a1", "v1"],
    ]);
  });

  test("a thread without views lists nothing", () => {
    expect(outputEntriesOf([turn("t1", [answer("a1", [])])])).toEqual([]);
  });

  test("the reopen button counts the views", () => {
    expect(reopenLabel(3)).toBe("Outputs · 3");
  });
});

describe("the panel's open, collapsed or closed choice", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
  };

  test("kept in this browser and read back", () => {
    const storage = memory();
    saveOutputsMode(() => storage, "collapsed");
    expect(storage.getItem(OUTPUTS_STORAGE_KEY)).toBe("collapsed");
    expect(readOutputsMode(() => storage)).toBe("collapsed");
  });

  test("missing, unknown or throwing storage means open", () => {
    expect(readOutputsMode(() => null)).toBe("open");
    const storage = memory();
    storage.setItem(OUTPUTS_STORAGE_KEY, "sideways");
    expect(readOutputsMode(() => storage)).toBe("open");
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readOutputsMode(() => throwing)).toBe("open");
    expect(() => saveOutputsMode(() => throwing, "closed")).not.toThrow();
  });
});
