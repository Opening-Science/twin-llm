import "server-only";

import { isStepCount, type LanguageModel, streamText, type ToolSet } from "ai";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import {
  type ParsedTwinAnswer,
  parseTwinAnswer,
} from "@/infrastructure/parse-twin-answer";
import { skillOfAuditTool, type TurnSkill } from "@/infrastructure/skill-gate";
import { UI_CONTEXT_AUDIT_TOOL, type UiContext } from "@/infrastructure/ui-context";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import { drainGbdTurn } from "@/packages/gbd-mcp/collector";
import { drainGuidelineTurn } from "@/packages/guidelines/collector";
import { drainKnowledgeTurn } from "@/packages/knowledge/collector";

import type { ChatRequest } from "./chat-request";
import { buildResponseDocumentV1 } from "./response/build-document";
import type { ResponseDocumentV1, ResponseToolCall } from "./response/document-v1";
import { inCallOrder } from "./tool-parts";
import { buildTwinSystemPrompt } from "./twin-system-prompt";

/**
 * One TwinLLM turn: the system prompt, the tools, the step limit and the
 * response document, with nothing about HTTP, storage or analytics.
 *
 * The chat route and the eval harness (`bun run eval`) both call this, so an
 * evaluated answer comes from the same prompt and tool wiring a user gets
 *. The caller picks the model and the tools and decides what happens
 * on finish: the route streams and stores, the harness writes a results line.
 */
export type TwinTurnWearables = Readonly<{
  oura: OuraSummary | null;
  whoop: WhoopSummary | null;
  googleHealth: GoogleHealthSummary | null;
  vitronic: VitronicSummary | null;
}>;

export type TwinTurnDeps = Readonly<{
  model: LanguageModel;
  tools: ToolSet;
  /**
   * Set when a user turned knowledge sources off, so the system prompt
   * names only tools this turn carries. Left out, the prompt names them all.
   */
  offeredTools?: ReadonlySet<string>;
  mode: DataMode;
  /**
   * The skill this turn runs under: its instructions join the system prompt
   * and its name goes on the response document. The caller has already cut
   * the tools down to it.
   */
  skill?: TurnSkill | null;
  /**
   * What the person had on screen (#47): a short block in the system prompt
   * and `ui_context` on the response document. Already audited by the caller.
   */
  uiContext?: UiContext | null;
  /** Audit rows for this turn's session, read after the model finishes. */
  loadAudit: (turnId: string) => Promise<readonly ResponseToolCall[]>;
}>;

export type TwinTurnInput = Readonly<{
  turnId: string;
  messages: ChatRequest["messages"];
  wearables: TwinTurnWearables;
  abortSignal?: AbortSignal;
}>;

export type TwinTurnToolResult = Readonly<{
  toolName: string;
  input: unknown;
  output: unknown;
}>;

export type TwinTurnFinish = Readonly<{
  text: string;
  usage: Readonly<{
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  }>;
  parsed: ParsedTwinAnswer;
  /** Every tool result of the turn, in step order and, within a step, in call order. */
  toolResults: readonly TwinTurnToolResult[];
  /** Reads the audit and drains the collectors; call it once. */
  buildDocument: () => Promise<ResponseDocumentV1>;
}>;

export type TwinTurnHooks = Readonly<{
  onFirstToken: () => void;
  onFinish: (finish: TwinTurnFinish) => Promise<void>;
  onError: (error: unknown) => Promise<void>;
  onAbort: () => void;
}>;

/** Model calls in one turn; the last one is kept for writing the answer. */
export const MAX_STEPS = 8;

/**
 * The last step has no tools, so a model that is still calling them writes
 * from what it has instead of stopping with nothing (the pilot fine-tune
 * spent all eight steps on lookups and wrote no answer).
 */
export const lastStepWithoutTools = (stepNumber: number) =>
  stepNumber >= MAX_STEPS - 1 ? { activeTools: [] } : undefined;

export const runTwinTurn = (
  deps: TwinTurnDeps,
  { turnId, messages, wearables, abortSignal }: TwinTurnInput,
  hooks: TwinTurnHooks,
) => {
  const system = buildTwinSystemPrompt({
    mode: deps.mode,
    oura: wearables.oura,
    whoop: wearables.whoop,
    googleHealth: wearables.googleHealth,
    vitronic: wearables.vitronic,
    offeredTools: deps.offeredTools,
    skill: deps.skill ?? null,
    uiContext: deps.uiContext ?? null,
  });

  return streamText({
    model: deps.model,
    system,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    tools: deps.tools,
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => lastStepWithoutTools(stepNumber),
    abortSignal,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") hooks.onFirstToken();
    },
    onFinish: async ({ text, totalUsage, steps }) => {
      const parsed = parseTwinAnswer(text, wearables);
      await hooks.onFinish({
        text,
        usage: {
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          totalTokens: totalUsage.totalTokens,
        },
        parsed,
        toolResults: steps.flatMap((step) =>
          inCallOrder(step.toolCalls, step.toolResults).map((result) => ({
            toolName: result.toolName,
            input: result.input,
            output: result.output,
          })),
        ),
        buildDocument: async () => {
          // The skill-run and UI context rows record the turn; they read nothing,
          // so they are not tool calls.
          const toolCalls = (await deps.loadAudit(turnId)).filter(
            (row) =>
              skillOfAuditTool(row.tool) === null && row.tool !== UI_CONTEXT_AUDIT_TOOL,
          );
          const gbd = drainGbdTurn(turnId);
          const guidelines = drainGuidelineTurn(turnId);
          const knowledge = drainKnowledgeTurn(turnId);
          return buildResponseDocumentV1({
            parsed,
            toolCalls,
            mode: deps.mode,
            gbdSources: gbd.sources,
            gbdRows: gbd.rows,
            guidelineSources: guidelines.sources,
            knowledgeSources: knowledge.sources,
            skill: deps.skill?.name ?? null,
            uiContext: deps.uiContext ?? null,
          });
        },
      });
    },
    onError: async ({ error }) => {
      await hooks.onError(error);
    },
    onAbort: () => {
      hooks.onAbort();
    },
  });
};
