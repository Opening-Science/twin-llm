import { z } from "zod";

import {
  type NotePermit,
  noteAuditEvent,
  notePermitFor,
  type NoteTurn,
  permitNoteDraft,
  type TwinNoteFields,
} from "@/infrastructure/twin-notes";
import {
  CATEGORY,
  isGenomeIdsBlocked,
  type ModelDisclosure,
} from "@/infrastructure/disclosure-ledger";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";
import type { AppendInput } from "@/packages/audit/append";

import {
  compactDraft,
  type CompactThread,
  DRAFT_SYSTEM,
  draftPrompt,
  type DraftSource,
  type DraftReply,
  draftSourceOf,
  parseDraftReply,
} from "./compact-draft";

/**
 * `POST /api/memory/compact` (#43): a draft twin note of one of the person's
 * own saved threads, from the thread's model. Nothing is stored here; the
 * person edits the draft and saves it through `POST /api/memory/notes`.
 *
 * Before the model is called: the person is known, the thread is theirs
 * (anyone else gets the same 404 as the thread page), it has an answer, and
 * the thread's own permit lets its model see it (`permitNoteDraft`). Then
 * `memory.note.draft` is written to the audit chain (and
 * `provider.personal_data_sent` when the request needs it); if that write
 * fails the model is not called. An incognito chat has no saved thread, so
 * it never reaches a draft.
 *
 * A model that fails or replies with something other than the JSON asked
 * for still gives a draft: the person's own questions as topics.
 *
 * The model gets `noteDraftDisclosure`: a model that is not on this machine
 * writes each request to the disclosure ledger (#140) before it is sent, and
 * a request that cannot be recorded is not sent (the draft then falls back
 * like any other model failure). The thread's questions go with it as what
 * the person typed (#414), so the check does not count a stored value they
 * wrote themselves. A request blocked for the person's own genome
 * identifiers (#356) falls back too, and its notice is the fixed refusal.
 */

export type DraftModel = Readonly<{
  /** The model that actually runs: an agent's base model. */
  modelId: string;
  generate: (input: Readonly<{ system: string; prompt: string }>) => Promise<string>;
}>;

export type CompactDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  /** The thread when the signed-in person owns it, else null. */
  loadOwnedThread: (threadId: string) => Promise<CompactThread | null>;
  /** True when the thread used a genome or imported-data tool. */
  threadIsLocal: (thread: CompactThread) => Promise<boolean>;
  turn: () => NoteTurn;
  /**
   * The thread's model as the catalog offers it now, sending through the
   * ledger, or null. `typed` is what the person wrote in the thread.
   */
  draftModel: (
    source: DraftSource,
    disclosure: ModelDisclosure,
    typed: readonly string[],
  ) => Promise<DraftModel | null>;
  /** The provider audit row for this request, or null when it needs none. */
  providerEvent: (
    actor: string,
    sessionId: string,
    modelId: string,
  ) => AppendInput | null;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  logError: (message: string, name: string) => void;
}>;

export type CompactResponse = Readonly<{
  draft: TwinNoteFields;
  permit: NotePermit;
  /** Set when the model gave no usable reply, or the request was blocked. */
  notice?: string;
}>;

export const COMPACT_COPY = {
  signIn: "Sign in to keep twin notes.",
  badRequest: "That request didn't look right. Try /compact again.",
  notFound: "That thread isn't one of yours.",
  empty: "Ask something first. /compact makes a note of a thread's answers.",
  modelGone: "This thread's model is no longer offered, so no note was drafted.",
  failed: "The note couldn't be drafted just now. Try again.",
  noReply: "The model gave no usable summary, so the topics are your own questions.",
} as const;

const bodySchema = z.object({ threadId: z.string().min(1).max(64) });

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** What a draft request carries: the thread's questions and answers, no stored values. */
export const noteDraftDisclosure = (
  actor: string,
  threadId: string,
  mode: NoteTurn["mode"],
): ModelDisclosure => ({
  actor,
  sessionId: threadId,
  threadId,
  purpose: "note draft",
  categories: [CATEGORY.question, CATEGORY.answers],
  refs: [],
  synthetic: mode === "synthetic",
});

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

/** What the person wrote in the thread: its questions, never its answers. */
export const typedInThread = (thread: CompactThread): readonly string[] =>
  thread.turns.map((turn) => turn.prompt);

type Drafted = Readonly<{ reply: DraftReply | null; blocked: boolean }>;

export const createCompactHandler =
  (deps: CompactDeps) =>
  async (request: Request): Promise<Response> => {
    const actor = await deps.resolveActorId();
    if (actor === null) return refuse(401, COMPACT_COPY.signIn);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return refuse(400, COMPACT_COPY.badRequest);

    const thread = await deps.loadOwnedThread(body.data.threadId);
    if (thread === null) return refuse(404, COMPACT_COPY.notFound);
    const source = draftSourceOf(thread);
    if (source === null) return refuse(400, COMPACT_COPY.empty);

    const turn = deps.turn();
    const facts = { dataMode: turn.mode, localThread: await deps.threadIsLocal(thread) };
    const permit = permitNoteDraft(facts, turn);
    if (!permit.ok) return refuse(403, permit.sentence);

    const model = await deps.draftModel(
      source,
      noteDraftDisclosure(actor, thread.id, turn.mode),
      typedInThread(thread),
    );
    if (model === null) return refuse(400, COMPACT_COPY.modelGone);

    try {
      const sent = deps.providerEvent(actor, thread.id, model.modelId);
      if (sent !== null) await deps.appendAudit(sent);
      await deps.appendAudit(
        noteAuditEvent("draft", {
          actor,
          sessionId: thread.id,
          ids: { threadId: thread.id },
          rowCount: thread.turns.length,
        }),
      );
    } catch (error) {
      deps.logError("[memory] could not audit the draft", errorName(error));
      return refuse(500, COMPACT_COPY.failed);
    }

    const { reply, blocked } = await model
      .generate({ system: DRAFT_SYSTEM, prompt: draftPrompt(thread) })
      .then((text): Drafted => ({ reply: parseDraftReply(text), blocked: false }))
      .catch((error: unknown): Drafted => {
        const isBlocked = isGenomeIdsBlocked(error);
        deps.logError(
          isBlocked
            ? "[memory] the draft request was blocked: genome identifiers"
            : "[memory] the draft model failed",
          errorName(error),
        );
        return { reply: null, blocked: isBlocked };
      });
    const notice = blocked
      ? GENOME_IDS_BLOCKED_SENTENCE
      : reply === null
        ? COMPACT_COPY.noReply
        : null;
    const response: CompactResponse = {
      draft: compactDraft(thread, reply),
      permit: notePermitFor(facts),
      ...(notice === null ? {} : { notice }),
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  };
