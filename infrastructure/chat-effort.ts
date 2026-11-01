import { z } from "zod";

import type { AppendInput } from "@/packages/audit/append";

/**
 * Effort (#366): how hard one answer works, in five steps. Each step changes
 * what the turn does, never only a label:
 *
 * | Effort   | Thinking | Model calls | Number check |
 * | -------- | -------- | ----------- | ------------ |
 * | Quick    | off      | 4           | no           |
 * | Balanced | off      | 8           | no           |
 * | Thorough | on       | 8           | no           |
 * | Deep     | on       | 12          | no           |
 * | Ultra    | on       | 12          | yes          |
 *
 * Balanced is the turn as it ran before effort existed. "Model calls" is the
 * step limit of one turn; the last step has no tools, so a model that is
 * still looking things up writes its answer from what it has. Thinking is
 * Ollama's `think` flag, switched on only for a model whose tags list the
 * `thinking` capability; on another provider the turn keeps that provider's
 * default and says so. The number check is a second pass over the finished
 * answer (`number-review.ts`).
 *
 * Pure, so the chat route, the prompt bar and the tests share one table.
 */

export const EFFORT_LEVELS = ["quick", "balanced", "thorough", "deep", "ultra"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const DEFAULT_EFFORT: EffortLevel = "balanced";

export const effortSchema = z.enum(EFFORT_LEVELS);

export type EffortPlan = Readonly<{
  level: EffortLevel;
  /** Ask the model to think before it answers, where it can. */
  thinking: boolean;
  /** Model calls in one turn, the last one without tools. */
  maxSteps: number;
  /** Run the number check on the finished answer. */
  review: boolean;
}>;

const PLANS: Readonly<Record<EffortLevel, Omit<EffortPlan, "level">>> = {
  quick: { thinking: false, maxSteps: 4, review: false },
  balanced: { thinking: false, maxSteps: 8, review: false },
  thorough: { thinking: true, maxSteps: 8, review: false },
  deep: { thinking: true, maxSteps: 12, review: false },
  ultra: { thinking: true, maxSteps: 12, review: true },
};

export const effortPlan = (level: EffortLevel): EffortPlan => ({
  level,
  ...PLANS[level],
});

/** A stored or sent value, or the default for anything else. */
export const parseEffort = (value: unknown): EffortLevel => {
  const parsed = effortSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_EFFORT;
};

/**
 * What thinking did on this turn: `on` and `off` as asked; `unavailable` when
 * asked for on a model that has no thinking mode; `provider-default` when the
 * provider is not Ollama and TwinLLM does not set it either way.
 */
export type ThinkingState = "on" | "off" | "unavailable" | "provider-default";

export type AppliedEffort = Readonly<{
  level: EffortLevel;
  thinking: ThinkingState;
  maxSteps: number;
  review: boolean;
}>;

/**
 * The plan as it applies to one model. `ollama` is whether the chat runs on
 * Ollama (only there is `think` set); `canThink` whether the model lists the
 * `thinking` capability.
 */
export const applyEffort = (
  level: EffortLevel,
  model: Readonly<{ ollama: boolean; canThink: boolean }>,
): AppliedEffort => {
  const plan = effortPlan(level);
  const thinking: ThinkingState = !model.ollama
    ? "provider-default"
    : !plan.thinking
      ? "off"
      : model.canThink
        ? "on"
        : "unavailable";
  return { level, thinking, maxSteps: plan.maxSteps, review: plan.review };
};

/**
 * The Ollama options a turn sends for its thinking, or null to send none and
 * keep the model's defaults (`ollama-chat-model.ts` sets `think: false`).
 */
export const thinkingProviderOptions = (
  applied: Pick<AppliedEffort, "thinking">,
): Readonly<{ ollama: Readonly<{ think: boolean }> }> | null =>
  applied.thinking === "on" ? { ollama: { think: true } } : null;

/** People-facing names and one line each, for the slider and its popover. */
export const EFFORT_COPY: Readonly<Record<EffortLevel, { label: string; line: string }>> =
  {
    quick: { label: "Quick", line: "No thinking, up to 4 model calls." },
    balanced: { label: "Balanced", line: "No thinking, up to 8 model calls." },
    thorough: {
      label: "Thorough",
      line: "Thinks first where the model can, up to 8 model calls.",
    },
    deep: {
      label: "Deep",
      line: "Thinks first where the model can, up to 12 model calls.",
    },
    ultra: {
      label: "Ultra",
      line: "Deep, then a second specialist checks every number against the tool results.",
    },
  };

/** The sentence under an answer that names its effort and what thinking did. */
export const effortLine = (applied: AppliedEffort): string => {
  const name = EFFORT_COPY[applied.level].label;
  const thinking =
    applied.thinking === "on"
      ? "thinking on"
      : applied.thinking === "off"
        ? "thinking off"
        : applied.thinking === "unavailable"
          ? "this model has no thinking mode"
          : "thinking left to the provider";
  return `${name} effort: ${thinking}, up to ${String(applied.maxSteps)} model calls${applied.review ? ", numbers checked" : ""}.`;
};

/** The audit tool name of the effort row; it reads nothing, so it is no tool call. */
export const EFFORT_AUDIT_TOOL = "chat.effort";

/**
 * The audit row written before an answer's model is called: the effort asked
 * for and what it became for this model. No prompt text.
 */
export const effortEvent = (
  applied: AppliedEffort,
  call: Readonly<{ actor: string; sessionId: string; modelId: string }>,
): AppendInput => ({
  actor: call.actor,
  sessionId: call.sessionId,
  subjectRef: null,
  tool: EFFORT_AUDIT_TOOL,
  args: { modelId: call.modelId, effort: applied.level },
  result: {
    thinking: applied.thinking,
    maxSteps: applied.maxSteps,
    review: applied.review,
  },
  rowCount: 0,
});
