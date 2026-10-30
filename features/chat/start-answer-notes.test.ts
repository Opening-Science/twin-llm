import { describe, expect, test } from "bun:test";

import type {
  ExoscalePersonalData,
  LlmProvider,
} from "@/infrastructure/data-mode-policy";
import type { TwinNote } from "@/infrastructure/twin-notes";
import type { AppendInput } from "@/packages/audit/append";

import type { ChatRequest } from "./chat-request";
import { createStartAnswer } from "./start-answer";
import type { StreamContext } from "./stream-model-response";

/**
 * Twin notes in a chat turn (#43): which are offered, the audit row, and an
 * audit failure. How many fit a turn is in `twin-notes-room.test.ts`.
 */

const ACTOR = "user_synthetic_1";
const APP_USER = "app-user-synthetic-1";
const CALL: ChatRequest = {
  modelId: "qwen3:4b",
  turnId: "turn-synthetic-1",
  messages: [{ role: "user", content: "How did the heart rate trend go?" }],
};

const note = (id: string, overrides: Partial<TwinNote> = {}): TwinNote => ({
  id,
  title: `Synthetic note ${id}`,
  topics: ["Heart rate over spring"],
  measures: ["8867-4 · trend · 1 Mar 2026 – 31 May 2026"],
  openQuestions: [],
  dataMode: "synthetic",
  permit: "synthetic",
  createdAt: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

const harness = (
  settings: Readonly<{
    dataMode: "synthetic" | "personal";
    provider: LlmProvider;
    exoscalePersonalData?: ExoscalePersonalData;
    chatIsLocal?: boolean;
  }>,
  notes: readonly TwinNote[] | undefined,
  auditFails = false,
) => {
  const audits: AppendInput[] = [];
  const streamed: StreamContext[] = [];
  const reads: string[] = [];
  const start = createStartAnswer({
    settings: () => ({
      dataMode: settings.dataMode,
      provider: settings.provider,
      exoscalePersonalData: settings.exoscalePersonalData ?? "off",
    }),
    chatIsLocal: () => settings.chatIsLocal ?? settings.provider === "ollama",
    loadGenomeThread: async () => ({ threadId: "thread-1", usedGenome: false }),
    loadWearables: async () => ({
      ouraSummary: null,
      whoopSummary: null,
      googleHealthSummary: null,
      vitronicSummary: null,
    }),
    loadDisabledSources: async () => [],
    findSkill: async () => null,
    appendAudit: async (input) => {
      if (auditFails) throw new Error("audit down");
      audits.push(input);
      return {};
    },
    ...(notes === undefined
      ? {}
      : {
          loadTwinNotes: async (userId: string, turnId: string) => {
            reads.push(`${userId} ${turnId}`);
            return notes;
          },
        }),
    // Records every offered note, as a stream with room for all of them does.
    stream: async (_call, context) => {
      const offer = context.twinNotes ?? null;
      if (offer !== null) {
        await offer.recordLoad(
          [...offer.notes]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((each) => each.id),
        );
      }
      streamed.push(context);
      return new Response("ok");
    },
    markRefused: async () => undefined,
  });
  return { start, audits, streamed, reads };
};

describe("twin notes in a chat turn", () => {
  test("synthetic notes load into a synthetic turn, audited with their ids", async () => {
    const { start, audits, streamed, reads } = harness(
      { dataMode: "synthetic", provider: "openrouter" },
      [note("a"), note("b", { createdAt: "2026-10-02T10:00:00.000Z" })],
    );
    expect((await start(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(reads).toEqual([`${APP_USER} ${CALL.turnId}`]);
    expect(audits.map((row) => [row.tool, row.args, row.rowCount])).toEqual([
      ["memory.notes.load", { noteIds: ["b", "a"] }, 2],
    ]);
    expect(streamed[0]?.twinNotes?.notes.map((each) => each.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(audits)).not.toContain("Heart rate over spring");
  });

  test("a personal note never reaches a synthetic turn, and a synthetic note no personal one", async () => {
    const synthetic = harness({ dataMode: "synthetic", provider: "ollama" }, [
      note("p", { dataMode: "personal", permit: "personal" }),
    ]);
    await synthetic.start(ACTOR, APP_USER, CALL);
    expect(synthetic.audits).toEqual([]);
    expect(synthetic.streamed[0]?.twinNotes).toBeUndefined();

    const personal = harness({ dataMode: "personal", provider: "ollama" }, [note("s")]);
    await personal.start(ACTOR, APP_USER, CALL);
    expect(personal.audits).toEqual([]);
    expect(personal.streamed[0]?.twinNotes).toBeUndefined();
  });

  test("a personal note goes to Exoscale only under the consented pilot", async () => {
    const personalNote = note("p", { dataMode: "personal", permit: "personal" });
    const pilot = harness(
      {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      [personalNote],
    );
    await pilot.start(ACTOR, APP_USER, CALL);
    expect(pilot.audits.map((row) => row.tool)).toEqual([
      "provider.personal_data_sent",
      "memory.notes.load",
    ]);
  });

  test("a local-only note loads only on Ollama on this machine", async () => {
    const localNote = note("l", { dataMode: "personal", permit: "local" });
    const pilot = harness(
      {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      [localNote],
    );
    await pilot.start(ACTOR, APP_USER, CALL);
    expect(pilot.audits.map((row) => row.tool)).toEqual(["provider.personal_data_sent"]);
    expect(pilot.streamed[0]?.twinNotes).toBeUndefined();

    const remoteOllama = harness(
      { dataMode: "personal", provider: "ollama", chatIsLocal: false },
      [localNote],
    );
    await remoteOllama.start(ACTOR, APP_USER, CALL);
    expect(remoteOllama.streamed[0]?.twinNotes).toBeUndefined();

    const local = harness({ dataMode: "personal", provider: "ollama" }, [localNote]);
    await local.start(ACTOR, APP_USER, CALL);
    expect(local.audits.map((row) => row.tool)).toEqual(["memory.notes.load"]);
  });

  test("when the load row cannot be written the model is not called", async () => {
    const { start, streamed } = harness(
      { dataMode: "synthetic", provider: "ollama" },
      [note("a")],
      true,
    );
    await expect(start(ACTOR, APP_USER, CALL)).rejects.toThrow("audit down");
    expect(streamed).toEqual([]);
  });

  test("without a note reader (incognito) nothing is read or audited", async () => {
    const { start, audits, streamed } = harness(
      { dataMode: "synthetic", provider: "ollama" },
      undefined,
    );
    await start(ACTOR, APP_USER, CALL);
    expect(audits).toEqual([]);
    expect(streamed[0]?.twinNotes).toBeUndefined();
  });
});
