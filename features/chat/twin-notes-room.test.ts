import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import {
  DEFAULT_OLLAMA_NUM_CTX,
  promptBudgetTokens,
} from "@/infrastructure/ollama-context";
import {
  NOTES_HEADING,
  NOTES_PROMPT_BUDGET,
  type TwinNote,
  twinNotesBlock,
} from "@/infrastructure/twin-notes";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { loadSkills, promptSizeCases, sizeRow } from "@/scripts/setup/prompt-size";
import { LONGEST_TWIN_NOTES } from "@/scripts/setup/prompt-size-fixtures";
import { createStreamModelResponse } from "./create-stream-model-response";
import { captureOllamaTurnRequest, systemTextOf } from "./ollama-turn-request";
import { fitTwinNotes, NOTES_SAFETY_TOKENS, notesRoomTokens } from "./twin-notes-room";

/** Twin notes take only the prompt room a turn leaves (#43). Made-up notes only. */

const CASES = promptSizeCases(loadSkills(`${import.meta.dir}/../..`));
const caseOf = (label: string) => {
  const found = CASES.find((sizeCase) => sizeCase.label === label);
  if (found === undefined) throw new Error(`no size case ${label}`);
  return found.turn;
};
const BUDGET = promptBudgetTokens(DEFAULT_OLLAMA_NUM_CTX);
const FULL = twinNotesBlock(LONGEST_TWIN_NOTES);

const notesIn = (system: string): string => {
  const start = system.indexOf(NOTES_HEADING);
  return start < 0 ? "" : system.slice(start, start + FULL.text.length + 1);
};

describe("notes room", () => {
  test("the room is the budget less the safety margin and what the turn uses, never negative", () => {
    expect(notesRoomTokens(1_000)).toBe(BUDGET - NOTES_SAFETY_TOKENS - 1_000);
    expect(notesRoomTokens(BUDGET)).toBe(0);
    expect(notesRoomTokens(1_000, 900)).toBe(0);
  });

  test("the turn with the largest tool set gets fewer notes and stays under the budget", async () => {
    const turn = {
      ...caseOf("personal, Oura, GBD imported agent:gp"),
      twinNotes: LONGEST_TWIN_NOTES,
    };
    const body = await captureOllamaTurnRequest(turn, DEFAULT_OLLAMA_NUM_CTX);
    const carried = notesIn(systemTextOf(body));
    expect(carried.length).toBeLessThan(FULL.text.length);
    expect(sizeRow("largest", body).estimate).toBeLessThanOrEqual(BUDGET);
  });

  test("a small turn still gets the full block, up to 1,200 characters of notes", async () => {
    const turn = { ...caseOf("personal, Oura /genome"), twinNotes: LONGEST_TWIN_NOTES };
    const body = await captureOllamaTurnRequest(turn, DEFAULT_OLLAMA_NUM_CTX);
    expect(FULL.ids.length).toBeGreaterThan(0);
    expect(notesIn(systemTextOf(body))).toContain(FULL.text);
    expect(FULL).toEqual(twinNotesBlock(LONGEST_TWIN_NOTES, NOTES_PROMPT_BUDGET));
  });

  test("no notes means no block", async () => {
    const turn = caseOf("personal, Oura /genome");
    const block = await fitTwinNotes(
      {
        tools: {},
        mode: turn.mode,
        skill: turn.skill,
      },
      { oura: null, whoop: null, googleHealth: null, vitronic: null },
      [],
    );
    expect(block).toEqual({ text: "", ids: [] });
  });
});

// ─── The chat stream: what is loaded is what is audited ────────────────────

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const answeringModel = () => {
  const systems: string[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      const system = options.prompt.find((message) => message.role === "system");
      systems.push(typeof system?.content === "string" ? system.content : "");
      return {
        stream: new ReadableStream({
          start: (controller) => {
            [
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Synthetic answer." },
              { type: "text-end", id: "t" },
              { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
            ].forEach((part) => controller.enqueue(part as never));
            controller.close();
          },
        }),
      };
    },
  });
  return { model, systems };
};

const NO_QUERY: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  findCohortObservations: async () => [],
  appendAudit: async () => undefined,
};

const streamWith = (model: MockLanguageModelV4) =>
  createStreamModelResponse({
    settings: () => ({ dataMode: "synthetic", provider: "ollama" }),
    chatIsLocal: () => true,
    resolveModel: () => model,
    genomeTools: () => undefined,
    variantTools: () => undefined,
    importedTools: () => undefined,
    loadAudit: async () => [],
    store: {
      writeComplete: async () => undefined,
      writeFailed: async () => undefined,
      markRefused: async () => undefined,
      loadViews: async () => [],
    },
    analytics: { answered: () => undefined, generation: async () => undefined },
    query: NO_QUERY,
  });

const note = (id: string, createdAt: string): TwinNote => ({
  id,
  title: `Synthetic note ${id}`,
  topics: ["Heart rate over spring"],
  measures: [],
  openQuestions: [],
  dataMode: "synthetic",
  permit: "synthetic",
  createdAt,
});

const CONTEXT = {
  clerkId: "user_synthetic_1",
  genomeThread: false,
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};
const REQUEST = {
  modelId: "qwen3:4b",
  turnId: "turn-synthetic-notes",
  messages: [{ role: "user" as const, content: "How did the heart rate trend go?" }],
};

describe("twin notes in the chat stream", () => {
  test("the kept notes join the prompt and their ids are recorded first", async () => {
    const { model, systems } = answeringModel();
    const recorded: (readonly string[])[] = [];
    const notes = [
      note("a", "2026-10-01T00:00:00.000Z"),
      note("b", "2026-10-02T00:00:00.000Z"),
    ];
    const response = await streamWith(model)(REQUEST, {
      ...CONTEXT,
      twinNotes: {
        notes,
        recordLoad: async (ids) => {
          expect(systems).toEqual([]);
          recorded.push(ids);
        },
      },
    });
    await response.text();
    expect(recorded).toEqual([["b", "a"]]);
    expect(systems[0]).toContain(twinNotesBlock(notes).text);
  });

  test("when the load cannot be recorded the model is not called", async () => {
    const { model, systems } = answeringModel();
    await expect(
      streamWith(model)(REQUEST, {
        ...CONTEXT,
        twinNotes: {
          notes: [note("a", "2026-10-01T00:00:00.000Z")],
          recordLoad: async () => {
            throw new Error("audit down");
          },
        },
      }),
    ).rejects.toThrow("audit down");
    expect(systems).toEqual([]);
  });
});
