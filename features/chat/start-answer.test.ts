import { describe, expect, test } from "bun:test";

import {
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
} from "@/infrastructure/data-mode-policy";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type { AppendInput } from "@/packages/audit/append";

import type { ChatRequest } from "./chat-request";
import { type ChatProviderSettings, createStartAnswer } from "./start-answer";
import type { StreamContext } from "./stream-model-response";
import type { WearableContext } from "./wearable-context";

const ACTOR = "user_synthetic_1";
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

/** Fakes for every port; `calls` records what reached each one, in order. */
const harness = (
  settings: ChatProviderSettings,
  wearables: WearableContext,
  options: Readonly<{ auditFails?: boolean }> = {},
) => {
  const calls: string[] = [];
  const audits: AppendInput[] = [];
  const streamed: StreamContext[] = [];
  const startAnswer = createStartAnswer({
    settings: () => settings,
    loadWearables: async (mode, appUserId) => {
      calls.push(`wearables ${mode} ${appUserId}`);
      return wearables;
    },
    loadDisabledSources: async () => ["gbd"],
    appendAudit: async (input) => {
      calls.push("audit");
      if (options.auditFails) throw new Error("audit-down");
      audits.push(input);
      return {};
    },
    stream: async (_call, context) => {
      calls.push("stream");
      streamed.push(context);
      return new Response("streamed");
    },
  });
  return { startAnswer, calls, audits, streamed };
};

const REFUSAL = {
  code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  error: PROVIDER_NOT_PERMITTED_ERROR,
};

describe("chat start: provider refusal", () => {
  test("wearable context to Exoscale with the setting off is the typed 400, nothing sent", async () => {
    const { startAnswer, calls, audits } = harness(
      { dataMode: "synthetic", provider: "exoscale", exoscalePersonalData: "off" },
      WITH_WHOOP,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables synthetic ${APP_USER}`]);
    expect(audits).toEqual([]);
  });

  test("DATA_MODE=personal to Exoscale with the setting off is refused per request too", async () => {
    const { startAnswer, calls } = harness(
      { dataMode: "personal", provider: "exoscale", exoscalePersonalData: "off" },
      NO_WEARABLES,
    );
    const response = await startAnswer(ACTOR, APP_USER, CALL);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(REFUSAL);
    expect(calls).toEqual([`wearables personal ${APP_USER}`]);
  });

  test("OpenRouter stays refused even under the consented pilot", async () => {
    const { startAnswer, calls } = harness(
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
    expect(calls).toEqual([`wearables personal ${APP_USER}`]);
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
      { clerkId: ACTOR, disabledSources: ["gbd"], ...WITH_WHOOP },
    ]);
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
