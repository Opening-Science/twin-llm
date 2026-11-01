import { describe, expect, test } from "bun:test";

import {
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import {
  GENOME_THREAD_LOCAL_ONLY,
  GENOME_THREAD_SENTENCE,
} from "@/infrastructure/genome-thread-policy";
import { type AppliedEffort, EFFORT_AUDIT_TOOL } from "@/infrastructure/chat-effort";
import type { LiveSourceId } from "@/infrastructure/live-sources";
import type { CatalogAgent } from "@/infrastructure/model-catalog";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type { AppendInput } from "@/packages/audit/append";
import { sha256Hex } from "@/packages/audit/hash";

import type { ChatRequest } from "./chat-request";
import { type ChatProviderSettings, createStartAnswer } from "./start-answer";
import type { StreamContext } from "./stream-model-response";
import type { WearableContext } from "./wearable-context";

const ACTOR = "user_synthetic_1";
const THREAD_ID = "thread-synthetic-1";
const APP_USER = "app-user-synthetic-1";
const CALL: ChatRequest = {
  modelId: "swiss-ai/Apertus-8B-Instruct-2509",
  turnId: "turn-synthetic-1",
  messages: [{ role: "user", content: "What changed in recovery this week?" }],
};

const WHOOP: WhoopSummary = {
  window: { startDate: "2026-01-01", endDate: "2026-01-04" },
  metrics: [],
  narrative: "Whoop wearable context for 2026-01-01 to 2026-01-04.",
};

const NO_WEARABLES: WearableContext = {
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

const WITH_WHOOP: WearableContext = { ...NO_WEARABLES, whoopSummary: WHOOP };

type RefusedRow = Readonly<{ turnId: string; modelId: string; sentence: string }>;

/** The row a refusal is stored on: this turn, this model, the sentence sent. */
const refusedRow = (sentence: string): RefusedRow => ({
  turnId: CALL.turnId,
  modelId: CALL.modelId,
  sentence,
});

/** Fakes for every port; `calls` records what reached each one, in order. */
const harness = (
  settings: ChatProviderSettings,
  wearables: WearableContext,
  options: Readonly<{
    auditFails?: boolean;
    skill?: TurnSkill;
    genomeThread?: boolean;
    chatIsLocal?: boolean;
    liveSources?: readonly LiveSourceId[];
  }> = {},
) => {
  const calls: string[] = [];
  const audits: AppendInput[] = [];
  const efforts: AppendInput[] = [];
  const applied: (AppliedEffort | null)[] = [];
  const streamed: StreamContext[] = [];
  const refused: RefusedRow[] = [];
  const threadReads: string[] = [];
  const startAnswer = createStartAnswer({
    settings: () => settings,
    chatIsLocal: () => options.chatIsLocal ?? settings.provider === "ollama",
    loadGenomeThread: async (turnId) => {
      threadReads.push(turnId);
      return { threadId: THREAD_ID, usedGenome: options.genomeThread ?? false };
    },
    loadWearables: async (mode, appUserId) => {
      calls.push(`wearables ${mode} ${appUserId}`);
      return wearables;
    },
    loadDisabledSources: async () => ["gbd"],
    ...(options.liveSources === undefined
      ? {}
      : { loadLiveSources: async () => options.liveSources ?? [] }),
    findSkill: async (name) => (name === SLEEP.name ? (options.skill ?? SLEEP) : null),
    appendAudit: async (input) => {
      if (options.auditFails) {
        calls.push("audit");
        throw new Error("audit-down");
      }
      // The effort row (#366) is on every turn; its own tests read `efforts`.
      if (input.tool === EFFORT_AUDIT_TOOL) {
        efforts.push(input);
        return {};
      }
      calls.push("audit");
      audits.push(input);
      return {};
    },
    stream: async (_call, { effort, ...context }) => {
      calls.push("stream");
      // Effort (#366) is on every stream; its own tests read `applied`.
      streamed.push(context);
      applied.push(effort ?? null);
      return new Response("streamed");
    },
    markRefused: async (target) => {
      calls.push("refused");
      refused.push(target);
    },
  });
  return {
    startAnswer,
    calls,
    audits,
    efforts,
    applied,
    streamed,
    refused,
    threadReads,
  };
};

const SLEEP: TurnSkill = {
  name: "sleep",
  description: "Chart the last nights of sleep.",
  tools: ["coverage", "baseline_deviation"],
  sources: ["cohort-records", "cohort-analytics", "wearable-context"],
  providers: ["ollama"],
  views: ["chart.timeseries"],
  instructions: "Describe sleep.",
};

const SLEEP_CALL: ChatRequest = { ...CALL, skill: "sleep" };

const REFUSAL = {
  code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  error: PROVIDER_NOT_PERMITTED_ERROR,
};

describe("chat start: provider refusal", () => {
  test("wearable context to Exoscale with the setting off is the typed 400, nothing sent", async () => {
    const { startAnswer, calls, audits, refused } = harness(
      { dataMode: "synthetic", provider: "exoscale", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "refused"]);
    expect(audits).toEqual([]);
    expect(refused).toEqual([refusedRow(PROVIDER_NOT_PERMITTED_SENTENCE)]);
  });

  test("DATA_MODE=personal to Exoscale with the setting off is refused per request too", async () => {
    const { startAnswer, calls, refused } = harness(
      { dataMode: "personal", provider: "exoscale", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "refused"]);
    expect(refused).toEqual([refusedRow(PROVIDER_NOT_PERMITTED_SENTENCE)]);
  });

  test("OpenRouter stays refused even under the consented pilot", async () => {
    const { startAnswer, calls, refused } = harness(
      {
        dataMode: "personal",
        provider: "openrouter",
        exoscalePersonalData: "consented-pilot",
      },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "refused"]);
    expect(refused).toEqual([refusedRow(PROVIDER_NOT_PERMITTED_SENTENCE)]);
  });
});

describe("chat start: consented pilot audit", () => {
  test("a personal request to Exoscale writes one audit event, then streams", async () => {
    const { startAnswer, calls, audits, streamed } = harness(
      {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("streamed");
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "stream"]);
    expect(audits).toEqual([
      {
        actor: ACTOR,
        sessionId: "turn-synthetic-1",
        subjectRef: null,
        tool: "provider.personal_data_sent",
        args: { provider: "exoscale", modelId: "swiss-ai/Apertus-8B-Instruct-2509" },
        result: { sent: true },
        rowCount: 0,
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("recovery");
    expect(JSON.stringify(audits)).not.toContain("Whoop");
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: false,
        disabledSources: ["gbd"],
        ...WITH_WHOOP,
      },
    ]);
  });

  test("an allowed request stores no refusal", async () => {
    const { startAnswer, refused } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    expect((await startAnswer(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(refused).toEqual([]);
  });

  test("a failed audit write stops the model call", async () => {
    const { startAnswer, calls } = harness(
      {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      NO_WEARABLES,
      { auditFails: true },
    );
    const error = await startAnswer(ACTOR, APP_USER, CALL).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((error as Error).message).toBe("audit-down");
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit"]);
  });

  test("synthetic data to Exoscale under the pilot is not audited", async () => {
    const { startAnswer, calls } = harness(
      {
        dataMode: "synthetic",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      NO_WEARABLES,
    );
    expect((await startAnswer(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "stream"]);
  });

  test("personal data to local Ollama is allowed and not audited", async () => {
    const { startAnswer, calls } = harness(
      { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    expect((await startAnswer(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "stream"]);
  });
});

describe("chat start: a turn sent with a skill", () => {
  test("runs on a listed provider: the run is audited, then streamed with the skill", async () => {
    const { startAnswer, calls, audits, streamed } = harness(
      { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    expect(response.status).toBe(200);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "stream"]);
    expect(audits).toEqual([
      {
        actor: ACTOR,
        sessionId: "turn-synthetic-1",
        subjectRef: null,
        tool: "skill.sleep",
        args: {
          skill: "sleep",
          modelId: "swiss-ai/Apertus-8B-Instruct-2509",
          provider: "ollama",
          tools: ["coverage", "baseline_deviation"],
          views: ["chart.timeseries"],
        },
        result: { started: true },
        rowCount: 0,
      },
    ]);
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: false,
        disabledSources: ["gbd"],
        skill: SLEEP,
        ...WITH_WHOOP,
      },
    ]);
  });

  test("a provider the skill does not list is refused with its sentence; nothing runs", async () => {
    const { startAnswer, calls, audits, refused } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    const sentence =
      "/sleep runs only on local Ollama. The models here come from OpenRouter, so /sleep did not run. Ask without /sleep instead.";
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "provider-not-allowed-by-skill",
      error: sentence,
    });
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "refused"]);
    expect(audits).toEqual([]);
    expect(refused).toEqual([refusedRow(sentence)]);
  });

  test("the skill refusal comes before the data-mode refusal", async () => {
    const { startAnswer } = harness(
      { dataMode: "personal", provider: "openrouter", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    expect(((await response.json()) as { code: string }).code).toBe(
      "provider-not-allowed-by-skill",
    );
  });

  test("the data-mode policy still applies to a provider the skill lists", async () => {
    const { startAnswer, calls, audits, refused } = harness(
      { dataMode: "personal", provider: "exoscale", exoscalePersonalData: "off" },
      WITH_WHOOP,
      { skill: { ...SLEEP, providers: ["ollama", "exoscale"] } },
    );
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "refused"]);
    expect(audits).toEqual([]);
    expect(refused).toEqual([refusedRow(PROVIDER_NOT_PERMITTED_SENTENCE)]);
  });

  test("wearable context with a skill that does not read it is refused", async () => {
    const { startAnswer, calls, refused } = harness(
      { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
      WITH_WHOOP,
      { skill: { ...SLEEP, sources: ["cohort-records"] } },
    );
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    const sentence =
      "/sleep does not read linked wearables, and this question would carry them, so /sleep did not run.";
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "source-not-allowed",
      error: sentence,
    });
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "refused"]);
    expect(refused).toEqual([refusedRow(sentence)]);
  });

  test("a skill the server does not offer is refused before anything is read", async () => {
    const { startAnswer, calls, audits, refused } = harness(
      { dataMode: "synthetic", provider: "ollama", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(ACTOR, APP_USER, { ...CALL, skill: "nap" });
    const sentence =
      "There is no /nap skill on this server, so nothing ran. Type / to see the skills it offers.";
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "skill-not-offered", error: sentence });
    expect(calls).toEqual(["refused"]);
    expect(audits).toEqual([]);
    expect(refused).toEqual([refusedRow(sentence)]);
  });
});

describe("chat start: a thread that used genome tools stays local (#151)", () => {
  const PILOT: ChatProviderSettings = {
    dataMode: "personal",
    provider: "exoscale",
    exoscalePersonalData: "consented-pilot",
  };
  const GENOME_REFUSAL = {
    code: GENOME_THREAD_LOCAL_ONLY,
    error: GENOME_THREAD_SENTENCE,
  };
  const refusedEvent = (provider: string): AppendInput => ({
    actor: ACTOR,
    sessionId: "turn-synthetic-1",
    subjectRef: null,
    tool: "genome.thread.refused",
    args: { provider, threadSha256: sha256Hex(THREAD_ID) },
    result: { refused: true },
    rowCount: 0,
  });

  test("genome thread + Exoscale consented pilot: refused, audited, nothing sent", async () => {
    const { startAnswer, calls, audits, streamed, refused, threadReads } = harness(
      PILOT,
      WITH_WHOOP,
      { genomeThread: true },
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(GENOME_REFUSAL);
    expect(threadReads).toEqual(["turn-synthetic-1"]);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "refused"]);
    expect(streamed).toEqual([]);
    expect(audits).toEqual([refusedEvent("exoscale")]);
    expect(JSON.stringify(audits)).not.toContain(THREAD_ID);
    expect(JSON.stringify(audits)).not.toContain("recovery");
    expect(refused).toEqual([
      refusedRow(
        "This thread used your genome report or imported data, so it only runs on local models.",
      ),
    ]);
  });

  test("genome thread + local Ollama: allowed, streamed as a genome thread", async () => {
    const { startAnswer, calls, audits, streamed, refused } = harness(
      { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
      NO_WEARABLES,
      { genomeThread: true },
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(200);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "stream"]);
    expect(audits).toEqual([]);
    expect(refused).toEqual([]);
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: true,
        disabledSources: ["gbd"],
        ...NO_WEARABLES,
      },
    ]);
  });

  test("non-genome thread + Exoscale consented pilot: unchanged, pilot audit then stream", async () => {
    const { startAnswer, calls, audits, streamed, threadReads } = harness(
      PILOT,
      WITH_WHOOP,
      { genomeThread: false },
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(200);
    expect(threadReads).toEqual(["turn-synthetic-1"]);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "stream"]);
    expect(audits.map((event) => event.tool)).toEqual(["provider.personal_data_sent"]);
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: false,
        disabledSources: ["gbd"],
        ...WITH_WHOOP,
      },
    ]);
  });

  test("Ollama on another machine is not local: refused", async () => {
    const { startAnswer, calls, audits } = harness(
      { dataMode: "personal", provider: "ollama", exoscalePersonalData: "off" },
      NO_WEARABLES,
      { genomeThread: true, chatIsLocal: false },
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(await response.json()).toEqual(GENOME_REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "refused"]);
    expect(audits).toEqual([refusedEvent("ollama")]);
  });

  test("synthetic mode on OpenRouter is refused too: the history still holds genotypes", async () => {
    const { startAnswer, calls, audits } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
      { genomeThread: true },
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(await response.json()).toEqual(GENOME_REFUSAL);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "audit", "refused"]);
    expect(audits).toEqual([refusedEvent("openrouter")]);
  });

  test("a history that shows a Carbon-X answer is refused even with no stored part", async () => {
    const { startAnswer, calls } = harness(PILOT, NO_WEARABLES, { genomeThread: false });
    const response = await startAnswer(ACTOR, APP_USER, {
      ...CALL,
      messages: [
        { role: "user", content: "/genome summarise my report" },
        { role: "assistant", content: "Carbon-X (research model): synthetic answer." },
        { role: "user", content: "And what about sleep?" },
      ],
    });
    expect(await response.json()).toEqual(GENOME_REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "refused"]);
  });

  test("a skill that asks for genome tools on a hosted provider is refused", async () => {
    const { startAnswer, calls } = harness(PILOT, NO_WEARABLES, {
      skill: {
        ...SLEEP,
        tools: ["genome_report", "dna_ask"],
        sources: ["ark-genome"],
        providers: ["ollama", "exoscale"],
        views: [],
      },
    });
    const response = await startAnswer(ACTOR, APP_USER, SLEEP_CALL);
    expect(await response.json()).toEqual(GENOME_REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "refused"]);
  });

  test("a failed audit write still refuses and still sends nothing", async () => {
    const { startAnswer, calls, refused } = harness(PILOT, NO_WEARABLES, {
      genomeThread: true,
      auditFails: true,
    });
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "refused"]);
    expect(refused).toEqual([refusedRow(GENOME_THREAD_SENTENCE)]);
  });
});

describe("chat start: a turn's UI context (#47)", () => {
  const SYNTHETIC_OLLAMA: ChatProviderSettings = {
    dataMode: "synthetic",
    provider: "ollama",
    exoscalePersonalData: "off",
  };
  const CONTEXT = {
    panels: ["outputs" as const],
    organ: "liver" as const,
    chart: null,
    views: [{ kind: "biomarker.card" as const, measure: "2324-2" }],
    viewCount: 1,
  };

  test("is written to the audit chain before the model is called", async () => {
    const { startAnswer, calls, audits } = harness(SYNTHETIC_OLLAMA, NO_WEARABLES);
    const response = await startAnswer(ACTOR, APP_USER, { ...CALL, uiContext: CONTEXT });
    expect(response.status).toBe(200);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "audit", "stream"]);
    expect(audits).toEqual([
      {
        actor: ACTOR,
        sessionId: CALL.turnId,
        subjectRef: null,
        tool: "ui.context",
        args: { modelId: CALL.modelId, context: CONTEXT },
        result: { lines: 3 },
        rowCount: 0,
      },
    ]);
  });

  test("a failed audit write stops the model call", async () => {
    const { startAnswer, calls } = harness(SYNTHETIC_OLLAMA, NO_WEARABLES, {
      auditFails: true,
    });
    await expect(
      startAnswer(ACTOR, APP_USER, { ...CALL, uiContext: CONTEXT }),
    ).rejects.toThrow("audit-down");
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "audit"]);
  });

  test("a turn without one writes no row", async () => {
    const { startAnswer, calls } = harness(SYNTHETIC_OLLAMA, NO_WEARABLES);
    await startAnswer(ACTOR, APP_USER, CALL);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "stream"]);
  });
});

describe("chat start: an agent (#218)", () => {
  const SLEEP_AGENT: CatalogAgent = {
    id: "sleep",
    name: "Sleep",
    role: "Describes sleep against the person's own recent nights.",
    skill: "sleep",
    baseModelId: "qwen3:8b",
    baseModelName: "qwen3:8b",
  };
  const GP_AGENT: CatalogAgent = {
    ...SLEEP_AGENT,
    id: "gp",
    name: "General",
    role: "Looks at the whole record.",
    skill: null,
  };
  const AGENT_CALL: ChatRequest = { ...CALL, modelId: "agent:sleep" };
  const LOCAL: ChatProviderSettings = {
    dataMode: "personal",
    provider: "ollama",
    exoscalePersonalData: "off",
  };

  test("its skill applies when the prompt names none; the audit row names the base model and the agent", async () => {
    const { startAnswer, calls, audits, streamed } = harness(LOCAL, WITH_WHOOP);
    const response = await startAnswer(ACTOR, APP_USER, AGENT_CALL, SLEEP_AGENT);
    expect(response.status).toBe(200);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "audit", "stream"]);
    expect(audits).toEqual([
      {
        actor: ACTOR,
        sessionId: "turn-synthetic-1",
        subjectRef: null,
        tool: "skill.sleep",
        args: {
          skill: "sleep",
          modelId: "qwen3:8b",
          provider: "ollama",
          tools: ["coverage", "baseline_deviation"],
          views: ["chart.timeseries"],
          agent: "sleep",
        },
        result: { started: true },
        rowCount: 0,
      },
    ]);
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: false,
        disabledSources: ["gbd"],
        skill: SLEEP,
        agent: SLEEP_AGENT,
        ...WITH_WHOOP,
      },
    ]);
  });

  test("an agent Auto picked runs the same way; its skill row says via auto (#219)", async () => {
    const { startAnswer, audits, streamed } = harness(LOCAL, WITH_WHOOP);
    const picked: CatalogAgent = { ...SLEEP_AGENT, via: "auto" };
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...CALL, modelId: "agent:auto" },
      picked,
    );
    expect(response.status).toBe(200);
    expect(audits.map(({ tool, args }) => [tool, args])).toEqual([
      [
        "skill.sleep",
        expect.objectContaining({ modelId: "qwen3:8b", agent: "sleep", via: "auto" }),
      ],
    ]);
    expect(streamed.map((context) => context.agent)).toEqual([picked]);
  });

  test("a /skill in the prompt wins over the agent's, and the row does not name the agent", async () => {
    const other: CatalogAgent = { ...SLEEP_AGENT, id: "trainer", skill: "trainer" };
    const { startAnswer, audits, streamed } = harness(LOCAL, WITH_WHOOP);
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...AGENT_CALL, modelId: "agent:trainer", skill: "sleep" },
      other,
    );
    expect(response.status).toBe(200);
    expect(audits.map(({ tool, args }) => ({ tool, args }))).toEqual([
      {
        tool: "skill.sleep",
        args: {
          skill: "sleep",
          modelId: "qwen3:8b",
          provider: "ollama",
          tools: ["coverage", "baseline_deviation"],
          views: ["chart.timeseries"],
        },
      },
    ]);
    expect(streamed.map((context) => context.skill)).toEqual([SLEEP]);
  });

  test("an agent with no skill runs without one and writes no skill row", async () => {
    const { startAnswer, calls, audits, streamed } = harness(LOCAL, NO_WEARABLES);
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...CALL, modelId: "agent:gp" },
      GP_AGENT,
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([`wearables personal ${APP_USER}`, "stream"]);
    expect(audits).toEqual([]);
    expect(streamed).toEqual([
      {
        clerkId: ACTOR,
        threadId: THREAD_ID,
        genomeThread: false,
        disabledSources: ["gbd"],
        agent: GP_AGENT,
        ...NO_WEARABLES,
      },
    ]);
  });

  test("its skill goes through the skill gate: a provider the skill does not list is refused naming the agent", async () => {
    const { startAnswer, audits, refused } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(ACTOR, APP_USER, AGENT_CALL, SLEEP_AGENT);
    const sentence =
      "Sleep isn't available here: its /sleep skill runs only on local Ollama.";
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "provider-not-allowed-by-skill",
      error: sentence,
    });
    expect(audits).toEqual([]);
    expect(refused).toEqual([{ turnId: CALL.turnId, modelId: "agent:sleep", sentence }]);
  });

  test("an agent skill the server does not offer is refused naming the agent", async () => {
    const { startAnswer, refused } = harness(LOCAL, NO_WEARABLES);
    const response = await startAnswer(ACTOR, APP_USER, AGENT_CALL, {
      ...SLEEP_AGENT,
      skill: "nap",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "skill-not-offered",
      error: "Sleep isn't available here: its /nap skill is not offered on this server.",
    });
    expect(refused.map(({ modelId }) => modelId)).toEqual(["agent:sleep"]);
  });

  test("a typed /skill that is refused keeps the skill's own sentence", async () => {
    const { startAnswer } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...AGENT_CALL, skill: "sleep" },
      SLEEP_AGENT,
    );
    expect(await response.json()).toEqual({
      code: "provider-not-allowed-by-skill",
      error:
        "/sleep runs only on local Ollama. The models here come from OpenRouter, so /sleep did not run. Ask without /sleep instead.",
    });
  });

  test("the pilot audit names the base model, not the agent row", async () => {
    const { startAnswer, audits } = harness(
      {
        dataMode: "personal",
        provider: "exoscale",
        exoscalePersonalData: "consented-pilot",
      },
      NO_WEARABLES,
    );
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...CALL, modelId: "agent:gp" },
      GP_AGENT,
    );
    expect(response.status).toBe(200);
    expect(audits.map(({ args }) => Reflect.get(Object(args), "modelId"))).toEqual([
      "qwen3:8b",
    ]);
  });
});

describe("chat start: live public lookups (#6)", () => {
  test("the person's switched-on live sources reach the turn", async () => {
    const { startAnswer, streamed } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
      { liveSources: ["pubmed"] },
    );
    expect((await startAnswer(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(streamed.map((context) => context.liveSources)).toEqual([["pubmed"]]);
  });

  test("without a loader (an incognito chat) the turn has none", async () => {
    const { startAnswer, streamed } = harness(
      { dataMode: "synthetic", provider: "openrouter", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    await startAnswer(ACTOR, APP_USER, CALL);
    expect(streamed.map((context) => context.liveSources)).toEqual([undefined]);
  });
});

describe("chat start: effort (#366)", () => {
  const OLLAMA: ChatProviderSettings = {
    dataMode: "synthetic",
    provider: "ollama",
    exoscalePersonalData: "off",
  };

  test("no effort sent runs Balanced, audited before the stream", async () => {
    const { startAnswer, calls, efforts, applied } = harness(OLLAMA, NO_WEARABLES);
    expect((await startAnswer(ACTOR, APP_USER, CALL)).status).toBe(200);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "stream"]);
    expect(efforts).toEqual([
      {
        actor: ACTOR,
        sessionId: CALL.turnId,
        subjectRef: null,
        tool: EFFORT_AUDIT_TOOL,
        args: { modelId: CALL.modelId, effort: "balanced" },
        result: { thinking: "off", maxSteps: 8, review: false },
        rowCount: 0,
      },
    ]);
    expect(applied).toEqual([
      { level: "balanced", thinking: "off", maxSteps: 8, review: false },
    ]);
  });

  test("Ultra on a model that can think: thinking on, 12 steps, the number check", async () => {
    const { startAnswer, applied, efforts } = harness(OLLAMA, NO_WEARABLES);
    const response = await startAnswer(
      ACTOR,
      APP_USER,
      { ...CALL, effort: "ultra" },
      null,
      { canThink: true },
    );
    expect(response.status).toBe(200);
    expect(applied).toEqual([
      { level: "ultra", thinking: "on", maxSteps: 12, review: true },
    ]);
    expect(efforts.map((row) => row.result)).toEqual([
      { thinking: "on", maxSteps: 12, review: true },
    ]);
  });

  test("Thorough on a model without thinking says so instead of switching it on", async () => {
    const { startAnswer, applied } = harness(OLLAMA, NO_WEARABLES);
    await startAnswer(ACTOR, APP_USER, { ...CALL, effort: "thorough" });
    expect(applied).toEqual([
      { level: "thorough", thinking: "unavailable", maxSteps: 8, review: false },
    ]);
  });

  test("a refused turn writes no effort row", async () => {
    const { startAnswer, efforts } = harness(
      { dataMode: "synthetic", provider: "exoscale", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    expect(
      (await startAnswer(ACTOR, APP_USER, { ...CALL, effort: "quick" })).status,
    ).toBe(400);
    expect(efforts).toEqual([]);
  });

  test("if the effort row cannot be written, the model is not called", async () => {
    const { startAnswer, calls } = harness(OLLAMA, NO_WEARABLES, { auditFails: true });
    await expect(startAnswer(ACTOR, APP_USER, CALL)).rejects.toThrow("audit-down");
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`, "audit"]);
  });
});
