import type { EffortLevel } from "@/infrastructure/chat-effort";
import type { ChatView } from "@/infrastructure/chat-view";
import type { GbdProfileFrame } from "@/infrastructure/gbd-profile-frame";
import type { LiveSourceId } from "@/infrastructure/live-sources";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { NumberSource } from "@/infrastructure/number-sources";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import type { UiContext } from "@/infrastructure/ui-context";

/**
 * The shapes one conversation is made of, shared by the server read of a
 * saved thread and the live screen, so a reloaded thread and the session
 * that produced it are the same state. Pure types; nothing here runs.
 */

/** Where one answer stands. A refused or stopped answer is FAILED with a mark. */
export type AnswerStatus = "STREAMING" | "COMPLETE" | "FAILED";

/** One named argument of a tool call, already in words. */
export type ToolArg = Readonly<{ label: string; value: string }>;

export type ToolCardState = "running" | "done" | "refused" | "error";

/** One tool call as a step card shows it. Never the call's output. */
export type ToolCard = Readonly<{
  /** The call id while streaming; the audit sequence number after a reload. */
  id: string;
  tool: string;
  /** Past-tense title ("Fitted a trend"). */
  title: string;
  args: readonly ToolArg[];
  state: ToolCardState;
  /** Rows read; null while running, after an error, or when unknown. */
  rowCount: number | null;
  /** The plain sentence for a refusal or a call that found nothing. */
  note?: string;
  /** The result code a refusal came back with (shown in the fold-out only). */
  code?: string;
  /** A gate turned the call away before it ran: it wrote no audit row. */
  didNotRun?: true;
  /** Display names the call's own output gave its measure codes. */
  measureNames?: Readonly<Record<string, string>>;
}>;

/** One model's answer in one turn. */
export type AnswerState = Readonly<{
  /** The answer row id (`<turn id>:<model id>` in incognito). */
  id: string;
  modelId: string;
  /** The column's display name, as stored with the answer. */
  modelName: string;
  status: AnswerStatus;
  text: string;
  tools?: readonly ToolCard[];
  views?: readonly ChatView[];
  profileFrame?: GbdProfileFrame | null;
  /** The body stopped before the server said it was done. */
  lost?: boolean;
  /** The person pressed Stop. */
  stopped?: boolean;
  /** An Ultra number check is running. */
  reviewing?: boolean;
  /** TwinLLM's own sentence for an answer no model gave. */
  refusal?: string;
  metrics: ModelResponseMetrics | null;
  reasoningText?: string | null;
  attribution?: readonly EvidenceAttribution[];
  document?: ResponseDocumentV1 | null;
  /** ISO 8601. */
  completedAt?: string | null;
  numberSources?: readonly NumberSource[];
}>;

/** One prompt and its answers. */
export type TurnState = Readonly<{
  id: string;
  /** What the models and the history get. */
  prompt: string;
  /** What the bubble shows when it differs from the prompt. */
  label?: string;
  answers: readonly AnswerState[];
  /** The skill the person sent the prompt with. */
  skill?: string | null;
  scheduled?: true;
  /** Kept in memory for retries only; never stored. */
  uiContext?: UiContext;
  /** Kept in memory for retries only. */
  effort?: EffortLevel;
  /** Shown while the server writes the turn; nothing streams against it. */
  provisional?: true;
}>;

/** A saved thread as its owner may read it. */
export type OwnedThread = Readonly<{
  id: string;
  title: string;
  turns: readonly TurnState[];
}>;

/** One answerer picked for a prompt: the row id and the column's display name. */
export type PickedModel = Readonly<{ id: string; name: string }>;

/** What the prompt bar hands the conversation on send. */
export type PromptSend = Readonly<{
  /** The prompt the models get (a chip's grounded prompt when sent from one). */
  prompt: string;
  models: readonly PickedModel[];
  skill: string | null;
  effort: EffortLevel;
  /** The bubble's text when it differs from the prompt (a chip's short text). */
  label: string | null;
}>;

/** Facts the `@` sources list may offer (server read, plain values only). */
export type PromptSourceFacts = Readonly<{
  imported: boolean;
  genome: boolean;
  live: readonly LiveSourceId[];
}>;

/** Chat settings from the environment, as plain values (SERVER-SPEC 3.11). */
export type ChatSettings = Readonly<{
  dataMode: "synthetic" | "personal";
  bodyLoopConfigured: boolean;
}>;
