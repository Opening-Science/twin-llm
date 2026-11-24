import "server-only";

import { stateOf } from "@/infrastructure/answer-state";
import {
  sealChatJson,
  sealChatNullable,
  sealChatText,
} from "@/infrastructure/chat-seal-contexts";
import { database } from "@/infrastructure/database";
import type { FieldCipher } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";

import {
  type ModelResponseCompleteParams,
  type ModelResponseCompleteUpdate,
  type ModelResponseFailedUpdate,
  type ModelResponseRefusedUpdate,
  type ModelResponseStoppedParams,
  type ModelResponseStoppedUpdate,
  writeModelResponseComplete,
  writeModelResponseFailed,
  writeModelResponseRefused,
  writeModelResponseStopped,
} from "./write-model-response-complete";

/**
 * The terminal answer writes, bound to the real database (the `answers`
 * table). Every text and JSON column is sealed with the conversation owner's
 * keys (#141) under its frozen context name (`chat-seal-contexts.ts`) before
 * it is written; the row's id is read first because it is part of each
 * value's context. The write ports keep the app's own names; here they
 * become the table's columns.
 */

type RowKey = ModelResponseCompleteUpdate["where"];

const answerKey = (where: RowKey) => ({
  exchangeId_answererRef: {
    exchangeId: where.turnId_modelId.turnId,
    answererRef: where.turnId_modelId.modelId,
  },
});

const rowOf = async (
  where: RowKey,
): Promise<Readonly<{ id: string; cipher: FieldCipher }>> => {
  const row = await database().answer.findUnique({
    where: answerKey(where),
    select: {
      id: true,
      exchange: { select: { conversation: { select: { ownerId: true } } } },
    },
  });
  if (row === null) throw new Error("model response row not found");
  return { id: row.id, cipher: await cipherForUser(row.exchange.conversation.ownerId) };
};

type JsonColumn = "evidence_sealed" | "document_sealed" | "tool_trace_sealed";

/** Undefined leaves a column as it is; null clears it. */
const sealOptionalJson = (
  cipher: FieldCipher,
  column: JsonColumn,
  id: string,
  value: unknown,
): string | null | undefined =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : sealChatJson(cipher, "answers", column, id, value);

const sealAnswer = (
  cipher: FieldCipher,
  id: string,
  data: ModelResponseCompleteUpdate["data"] | ModelResponseStoppedUpdate["data"],
) => ({
  ...(data.status === "COMPLETE"
    ? {
        firstTokenMs: data.timeToFirstTokenMs,
        tokensPerSecond: data.tokensPerSecond,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
      }
    : {}),
  state: stateOf(data.status),
  closedAt: data.completedAt,
  bodySealed: sealChatText(cipher, "answers", "body_sealed", id, data.text),
  reasoningSealed: sealChatNullable(
    cipher,
    "answers",
    "reasoning_sealed",
    id,
    data.reasoningText,
  ),
  evidenceSealed: sealOptionalJson(cipher, "evidence_sealed", id, data.attribution),
  documentSealed: sealOptionalJson(cipher, "document_sealed", id, data.responseDocument),
  toolTraceSealed: sealOptionalJson(cipher, "tool_trace_sealed", id, data.toolParts),
});

const writeAnswer = async ({
  where,
  data,
}: ModelResponseCompleteUpdate | ModelResponseStoppedUpdate): Promise<unknown> => {
  const { id, cipher } = await rowOf(where);
  return database().answer.update({ where: { id }, data: sealAnswer(cipher, id, data) });
};

export const markModelResponseComplete = (params: ModelResponseCompleteParams) =>
  writeModelResponseComplete({ update: writeAnswer }, params);

export const markModelResponseStopped = (params: ModelResponseStoppedParams) =>
  writeModelResponseStopped({ update: writeAnswer }, params);

export const markModelResponseFailed = (
  target: Readonly<{ turnId: string; modelId: string }>,
) =>
  writeModelResponseFailed(
    {
      update: ({ where, data }: ModelResponseFailedUpdate) =>
        database().answer.update({
          where: answerKey(where),
          data: { state: stateOf(data.status), closedAt: data.completedAt },
        }),
    },
    target,
  );

export const markModelResponseRefused = (
  target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
) =>
  writeModelResponseRefused(
    {
      update: async ({ where, data }: ModelResponseRefusedUpdate) => {
        const { id, cipher } = await rowOf(where);
        return database().answer.update({
          where: { id },
          data: {
            state: stateOf(data.status),
            closedAt: data.completedAt,
            bodySealed: sealChatText(cipher, "answers", "body_sealed", id, data.text),
          },
        });
      },
    },
    target,
  );
