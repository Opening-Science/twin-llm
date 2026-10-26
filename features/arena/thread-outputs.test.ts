import { describe, expect, test } from "bun:test";

import { timeseriesView } from "@/infrastructure/chat-view";

import type { TurnState } from "./conversation";
import { type SavedResponseRow, toSavedResponseState } from "./saved-response-state";
import {
  PANEL_KEY,
  readPanelState,
  savePanelState,
  threadOutputs,
  viewKindLabel,
} from "./thread-outputs";

const view = (seq: string, label: string) =>
  timeseriesView({
    spec: {
      measure: "sleep.score",
      label,
      unit: null,
      window: { start: "2026-10-01", end: "2026-10-03" },
      subject: null,
      points: [{ at: "2026-10-01T00:00:00.000Z", value: 77 }],
    },
    sourceAuditIds: [seq],
  });

const sleep = view("7", "Sleep score");
const hrv = view("8", "HRV");
const rhr = view("9", "Resting heart rate");

const part = (seq: number, tool: string, output: unknown) => ({
  seq,
  tool,
  input: {},
  output,
  argsSha256: "a".repeat(64),
  resultSha256: "b".repeat(64),
  rowCount: null,
  at: "2026-10-20T10:00:00.000Z",
});

const row = (
  id: string,
  modelName: string,
  completedAt: string,
  toolParts: unknown,
): SavedResponseRow => ({
  id,
  modelId: `synthetic/${modelName}`,
  modelName,
  position: 0,
  status: "COMPLETE",
  text: "## Answer\nSynthetic.",
  reasoningText: null,
  attribution: null,
  responseDocument: null,
  toolParts,
  timeToFirstTokenMs: null,
  tokensPerSecond: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: 0,
  completedAt: new Date(completedAt),
});

/** Two saved turns, as the thread page builds them from stored tool parts. */
const saved: TurnState[] = [
  {
    id: "turn-1",
    prompt: "Synthetic one",
    answers: [
      row("r-1a", "Model A", "2026-10-20T10:00:00.000Z", [
        part(1, "show_view", sleep),
        part(2, "show_view", hrv),
      ]),
      row("r-1b", "Model B", "2026-10-20T10:01:00.000Z", [
        part(1, "latest_by_loinc", { rows: [] }),
      ]),
    ].map(toSavedResponseState),
  },
  {
    id: "turn-2",
    prompt: "Synthetic two",
    answers: [
      row("r-2a", "Model A", "2026-10-21T09:00:00.000Z", [
        part(1, "open_view", sleep),
        part(2, "show_view", rhr),
      ]),
    ].map(toSavedResponseState),
  },
];

describe("threadOutputs", () => {
  test("lists every stored view newest first, a reopened one once at its newest", () => {
    expect(
      threadOutputs(saved).map((entry) => [
        entry.view.title,
        entry.modelName,
        entry.at,
        entry.anchorId,
      ]),
    ).toEqual([
      [
        "Resting heart rate, 1 Oct 2026 – 3 Oct 2026",
        "Model A",
        "2026-10-21T09:00:00.000Z",
        "output-r-2a-view-9",
      ],
      [
        "Sleep score, 1 Oct 2026 – 3 Oct 2026",
        "Model A",
        "2026-10-21T09:00:00.000Z",
        "output-r-2a-view-7",
      ],
      [
        "HRV, 1 Oct 2026 – 3 Oct 2026",
        "Model A",
        "2026-10-20T10:00:00.000Z",
        "output-r-1a-view-8",
      ],
    ]);
  });

  test("a view still streaming has no time and comes first in its turn", () => {
    const live: TurnState = {
      id: "turn-3",
      prompt: "Synthetic three",
      answers: [
        {
          id: "r-3a",
          modelId: "m",
          modelName: "Model A",
          status: "COMPLETE",
          text: "",
          metrics: null,
          views: [view("10", "Steps")],
          completedAt: "2026-10-22T09:00:00.000Z",
        },
        {
          id: "r-3b",
          modelId: "n",
          modelName: "Model B",
          status: "STREAMING",
          text: "",
          metrics: null,
          views: [view("11", "Weight")],
        },
      ],
    };
    expect(threadOutputs([live]).map((entry) => [entry.modelName, entry.at])).toEqual([
      ["Model B", null],
      ["Model A", "2026-10-22T09:00:00.000Z"],
    ]);
  });

  test("no views, no entries", () => {
    expect(threadOutputs([])).toEqual([]);
    expect(viewKindLabel("chart.timeseries")).toBe("Time series");
  });
});

describe("panel state storage", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  };

  test("opens by default and remembers a choice", () => {
    const storage = memory();
    expect(readPanelState(storage)).toBe("open");
    savePanelState(storage, "closed");
    expect(storage.items.get(PANEL_KEY)).toBe("closed");
    expect(readPanelState(storage)).toBe("closed");
  });

  test("missing, throwing or odd storage opens and never throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPanelState(null)).toBe("open");
    expect(readPanelState(throwing)).toBe("open");
    expect(() => savePanelState(throwing, "collapsed")).not.toThrow();
    const odd = memory();
    odd.items.set(PANEL_KEY, "sideways");
    expect(readPanelState(odd)).toBe("open");
  });
});
