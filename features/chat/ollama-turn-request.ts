import "server-only";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import {
  DEFAULT_OLLAMA_BASE_URL,
  estimateTokens,
  JSON_CHARS_PER_TOKEN,
  TEMPLATE_OVERHEAD_TOKENS,
} from "@/infrastructure/ollama-context";
import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { UiContext } from "@/infrastructure/ui-context";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { createChatTools, forSkill, forSources } from "./chat-tools";
import type { GenomeToolDeps } from "./genome-tools";
import { ollamaChatModel } from "./ollama-chat-model";
import { runTwinTurn } from "./run-twin-turn";

/**
 * The exact body a first chat turn sends to Ollama's `/api/chat`: the twin
 * system prompt and the model-facing tool list, built the way the chat route
 * builds them, through the real provider. Nothing is called: the fetch records
 * the body and answers with an empty reply, and the ports refuse everything.
 *
 * The context-budget test and `scripts/setup/prompt-size.ts` measure this, so
 * a longer prompt, a new tool or a bigger schema shows up in both.
 */

export type OllamaChatTool = Readonly<{
  type: "function";
  function: Readonly<{ name: string; description?: string; parameters: unknown }>;
}>;

export type OllamaChatBody = Readonly<{
  model: string;
  messages: readonly Readonly<{ role: string; content: string }>[];
  tools?: readonly OllamaChatTool[];
  options?: Readonly<{ num_ctx?: number }>;
  think?: boolean;
}>;

export type TurnRequestCase = Readonly<{
  mode: DataMode;
  skill: TurnSkill | null;
  wearables: WearableSummaries;
  /** The question; short, since the budget is about what comes before it. */
  question: string;
  /** The turn's UI context block (#47); the size cases carry the longest one. */
  uiContext?: UiContext | null;
  /** The agent the turn answers as (#218), whose role line joins the prompt. */
  agent?: Readonly<{ name: string; role: string }> | null;
}>;

const NO_PORTS: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  findCohortObservations: async () => [],
  appendAudit: async () => undefined,
};

const noGenome = (scope: GenomeToolDeps["scope"]): GenomeToolDeps => ({
  scope,
  loadReport: async () => null,
  assumeBuild: null,
  windows: async () => ({ code: "NONE", error: "not used" }),
  ask: async () => {
    throw new Error("not used");
  },
  appendAudit: async () => undefined,
});

/** The imported-data tools as a fully local personal turn gets them; nothing is read. */
const noImported = (scope: ImportedToolDeps["scope"]): ImportedToolDeps => ({
  scope,
  permit: () => ({ ok: true }),
  ports: {
    listDatasets: async () => [],
    listSeries: async () => [],
    findLatest: async () => [],
    findSeries: async () => [],
    listTables: async () => [],
    readTableRows: async () => [],
    findConditions: async () => [],
    findMedications: async () => [],
    appendAudit: async () => undefined,
  },
});

const EMPTY_REPLY = `${JSON.stringify({
  model: "measure",
  created_at: "2026-01-01T00:00:00Z",
  message: { role: "assistant", content: "" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 0,
  eval_count: 0,
})}\n`;

const bodyOf = (init: RequestInit | undefined): OllamaChatBody =>
  JSON.parse(typeof init?.body === "string" ? init.body : "{}") as OllamaChatBody;

export const captureOllamaTurnRequest = async (
  turn: TurnRequestCase,
  numCtx: number,
): Promise<OllamaChatBody> => {
  const hasWearableNarrative = Object.values(turn.wearables).some(
    (summary) => summary !== null,
  );
  const scope = { actor: "measure", sessionId: "measure", mode: turn.mode };
  const { tools, offeredTools } = forSkill(
    forSources(
      createChatTools(scope, {
        query: NO_PORTS,
        hasWearableNarrative,
        wearables: turn.wearables,
        views: turn.skill?.views,
        sources: turn.skill?.sources,
        loadViews: async () => [],
        genome: noGenome(scope),
        imported: noImported(scope),
      }),
      [],
    ).tools,
    turn.skill,
  );
  const sent: OllamaChatBody[] = [];
  const record = async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(bodyOf(init));
    return new Response(EMPTY_REPLY, {
      headers: { "content-type": "application/x-ndjson" },
    });
  };
  // Only called as a function; Bun's `fetch` type also carries `preconnect`.
  const recording = record as unknown as typeof fetch;
  const result = runTwinTurn(
    {
      model: ollamaChatModel("measure", {
        baseUrl: DEFAULT_OLLAMA_BASE_URL,
        numCtx,
        fetch: recording,
      }),
      tools,
      offeredTools,
      mode: turn.mode,
      skill: turn.skill,
      uiContext: turn.uiContext ?? null,
      agent: turn.agent ?? null,
      loadAudit: async () => [],
    },
    {
      turnId: "measure",
      messages: [{ role: "user", content: turn.question }],
      wearables: turn.wearables,
    },
    {
      onFirstToken: () => undefined,
      onFinish: async () => undefined,
      onError: async () => undefined,
      onAbort: () => undefined,
    },
  );
  await result.consumeStream();
  const [body] = sent;
  if (body === undefined) throw new Error("the turn sent no request to Ollama");
  return body;
};

/** The system prompt as Ollama receives it. */
export const systemTextOf = (body: OllamaChatBody): string =>
  body.messages.find((message) => message.role === "system")?.content ?? "";

/** The tool list as the Qwen3 template prints it: one JSON object per line. */
export const toolTextOf = (body: OllamaChatBody): string =>
  (body.tools ?? []).map((tool) => JSON.stringify(tool)).join("\n");

/** A conservative token count of everything that precedes the question. */
export const estimatePromptTokens = (body: OllamaChatBody): number =>
  estimateTokens(systemTextOf(body)) +
  estimateTokens(toolTextOf(body), JSON_CHARS_PER_TOKEN) +
  TEMPLATE_OVERHEAD_TOKENS;
