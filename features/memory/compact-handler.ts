import { z } from "zod";

import {
  type NotePermit,
  noteAuditEvent,
  notePermitFor,
  type NoteTurn,
  permitNoteDraft,
  type TwinNoteFields,
} from "@/infrastructure/twin-notes";
import type { AppendInput } from "@/packages/audit/append";

import {
  compactDraft,
  type CompactThread,
  DRAFT_SYSTEM,
  draftPrompt,
  type DraftSource,
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
  /** The thread's model as the catalog offers it now, or null. */
  draftModel: (source: DraftSource) => Promise<DraftModel | null>;
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
  /** Set when the model gave no usable reply. */
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

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

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

    const model = await deps.draftModel(source);
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

    const reply = await model
      .generate({ system: DRAFT_SYSTEM, prompt: draftPrompt(thread) })
      .then(parseDraftReply)
      .catch((error: unknown) => {
        deps.logError("[memory] the draft model failed", errorName(error));
        return null;
      });
    const response: CompactResponse = {
      draft: compactDraft(thread, reply),
      permit: notePermitFor(facts),
      ...(reply === null ? { notice: COMPACT_COPY.noReply } : {}),
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  };
