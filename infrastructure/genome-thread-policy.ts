import {
  CARBON_X_LABEL,
  DNA_ASK_AUDIT_TOOL,
  GENOME_REPORT_AUDIT_TOOL,
  GENOME_TOOLS,
} from "@/packages/carbon-x/constants";
import {
  GENOME_VARIANTS_AUDIT_TOOL,
  IMPORTED_TOOLS,
} from "@/packages/query-tools/imported-names";

import type { LlmProvider } from "./data-mode-policy";

/**
 * Genome rules per thread, not only per question (#151). Pure and free of
 * Node APIs, so the chat route, the browser's refusal sentence, a future
 * export (#44) and the tests share one decision. The audit row is built in
 * `genome-thread-audit.ts`.
 *
 * A thread keeps its history. Once `genome_report` or `dna_ask` ran in it, its
 * stored answers and tool results can hold genotypes, so the whole thread is
 * genome-personal. The imported-data tools (#181) count the same way: their
 * results hold values from the person's own files, which only a local model
 * may read. Such a thread is local-only: every later turn runs only on a local chat model (Ollama on
 * loopback), and an export goes only to a recipient on this machine. A hosted
 * provider is refused before any history is sent, the consented Exoscale pilot
 * included, and the refusal is audited with the provider and a hash of the
 * thread id only.
 */

export const GENOME_THREAD_LOCAL_ONLY = "GENOME_THREAD_LOCAL_ONLY" as const;

/** What a person reads, stored on the refused row and shown on reload. */
export const GENOME_THREAD_SENTENCE =
  "This thread used your genome report or imported data, so it only runs on local models.";

/** Audit `tool` name for a refused turn of a genome-personal thread. */
export const GENOME_THREAD_REFUSED_AUDIT_TOOL = "genome.thread.refused" as const;

/** Audit `tool` name for a refused export of a genome-personal thread (#44). */
export const GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL =
  "genome.thread.export_refused" as const;

const GENOME_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...GENOME_TOOLS,
  ...IMPORTED_TOOLS,
]);

/**
 * Audit `tool` names that make a thread local-only: the genome tools' and the
 * imported-data tools' (which audit under their own names).
 */
export const LOCAL_ONLY_AUDIT_TOOLS: readonly string[] = [
  GENOME_REPORT_AUDIT_TOOL,
  DNA_ASK_AUDIT_TOOL,
  GENOME_VARIANTS_AUDIT_TOOL,
  ...IMPORTED_TOOLS,
];

const GENOME_AUDIT_TOOLS: ReadonlySet<string> = new Set(LOCAL_ONLY_AUDIT_TOOLS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * True when a stored `toolParts` column holds a genome or imported-data tool call. Read loosely
 * on purpose: a part that is malformed elsewhere still counts if it names a
 * genome tool, so a damaged row cannot hide one.
 */
export const toolPartsUseGenome = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.some(
    (part) =>
      isRecord(part) && typeof part.tool === "string" && GENOME_TOOL_NAMES.has(part.tool),
  );

/** True when an audit row's tool is a genome or imported-data chat tool. */
export const isGenomeAuditTool = (tool: string): boolean => GENOME_AUDIT_TOOLS.has(tool);

/** True when a turn's tools (a skill's list, say) include a genome or imported-data tool. */
export const requestsGenomeTools = (tools: readonly string[]): boolean =>
  tools.some((name) => GENOME_TOOL_NAMES.has(name));

/** A history line that reads back a genome skill turn (`/genome …`). */
const GENOME_SKILL_PROMPT = /^\/genome(\s|$)/;

export type HistoryLine = Readonly<{ role: "user" | "assistant"; content: string }>;

/**
 * True when the history itself shows genome use: a `/genome` prompt, or a
 * Carbon-X answer label. A backstop for the stored-thread check, which is the
 * rule; this one catches a history that came from somewhere else.
 */
export const historyShowsGenome = (messages: readonly HistoryLine[]): boolean =>
  messages.some(
    (message) =>
      message.content.includes(CARBON_X_LABEL) ||
      (message.role === "user" && GENOME_SKILL_PROMPT.test(message.content.trimStart())),
  );

/** The chat model runs on this machine: Ollama, and Ollama on loopback. */
export const isLocalChatModel = (provider: LlmProvider, onLoopback: boolean): boolean =>
  provider === "ollama" && onLoopback;

export type GenomeThreadDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof GENOME_THREAD_LOCAL_ONLY;
      readonly error: typeof GENOME_THREAD_SENTENCE;
    };

const REFUSED: GenomeThreadDecision = {
  ok: false,
  code: GENOME_THREAD_LOCAL_ONLY,
  error: GENOME_THREAD_SENTENCE,
};

/** May a turn of this thread go to this chat model? */
export const permitGenomeThreadTurn = (
  input: Readonly<{ genomeThread: boolean; chatIsLocal: boolean }>,
): GenomeThreadDecision =>
  input.genomeThread && !input.chatIsLocal ? REFUSED : { ok: true };

/**
 * May this thread be exported to this recipient? For `/report` (#44): a
 * genome-personal thread leaves only for a recipient on this machine (a file
 * written locally); a PDF or FHIR document sent to any hosted service, the
 * consented pilot included, is refused. Call it with the same thread check
 * the chat uses (`toolPartsUseGenome` and `isGenomeAuditTool` over the
 * thread) and audit a refusal with `genomeThreadRefusedEvent`
 * (`genome-thread-audit.ts`, tool `genome.thread.export_refused`).
 */
export const permitGenomeThreadExport = (
  input: Readonly<{ genomeThread: boolean; recipientIsLocal: boolean }>,
): GenomeThreadDecision =>
  input.genomeThread && !input.recipientIsLocal ? REFUSED : { ok: true };

/**
 * The defence-in-depth check right before history goes to a model: a
 * non-local model must never get the history of a genome-personal thread, or
 * any history that shows genome use. Fails closed by throwing; the caller
 * refuses the turn instead of calling the model.
 */
export const assertHistoryMayLeave = (
  input: Readonly<{
    chatIsLocal: boolean;
    genomeThread: boolean;
    messages: readonly HistoryLine[];
  }>,
): void => {
  if (input.chatIsLocal) return;
  if (input.genomeThread || historyShowsGenome(input.messages)) {
    throw new Error(`${GENOME_THREAD_LOCAL_ONLY}: genome history held back`);
  }
};
