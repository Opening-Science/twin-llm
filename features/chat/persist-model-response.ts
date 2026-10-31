import "server-only";

import { database } from "@/infrastructure/database";
import { type FieldCipher, sealJson, sealNullable } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";

import {
  type ModelResponseCompleteParams,
  type ModelResponseCompleteUpdate,
  type ModelResponseWritePort,
  writeModelResponseComplete,
  writeModelResponseFailed,
  writeModelResponseRefused,
} from "./write-model-response-complete";

/**
 * The terminal row writes, bound to the real database. Every text and JSON
 * column is sealed with the thread owner's keys (#141) before it is written;
 * the row's id is read first because it is part of each value's context.
 */

const TABLE = "model_responses";

type RowKey = ModelResponseCompleteUpdate["where"];

const rowOf = async (
  where: RowKey,
): Promise<Readonly<{ id: string; cipher: FieldCipher }>> => {
  const row = await database().modelResponse.findUnique({
    where,
    select: { id: true, turn: { select: { thread: { select: { userId: true } } } } },
  });
  if (row === null) throw new Error("model response row not found");
  return { id: row.id, cipher: await cipherForUser(row.turn.thread.userId) };
};

/** Undefined leaves a column as it is; null clears it. */
const sealOptionalJson = (
  cipher: FieldCipher,
  column: string,
  id: string,
  value: unknown,
): string | null | undefined =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : sealJson(cipher, TABLE, column, id, value);

const completePort: ModelResponseWritePort = {
  update: async ({ where, data }) => {
    const { id, cipher } = await rowOf(where);
    return database().modelResponse.update({
      where: { id },
      data: {
        ...data,
        text: cipher.sealText(TABLE, "text", id, data.text),
        reasoningText: sealNullable(
          cipher,
          TABLE,
          "reasoningText",
          id,
          data.reasoningText,
        ),
        attribution: sealOptionalJson(cipher, "attribution", id, data.attribution),
        responseDocument: sealOptionalJson(
          cipher,
          "responseDocument",
          id,
          data.responseDocument,
        ),
        toolParts: sealOptionalJson(cipher, "toolParts", id, data.toolParts),
      },
    });
  },
};

export const markModelResponseComplete = (params: ModelResponseCompleteParams) =>
  writeModelResponseComplete(completePort, params);

export const markModelResponseFailed = (
  target: Readonly<{ turnId: string; modelId: string }>,
) => writeModelResponseFailed(database().modelResponse, target);

export const markModelResponseRefused = (
  target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
) =>
  writeModelResponseRefused(
    {
      update: async ({ where, data }) => {
        const { id, cipher } = await rowOf(where);
        return database().modelResponse.update({
          where: { id },
          data: { ...data, text: cipher.sealText(TABLE, "text", id, data.text) },
        });
      },
    },
    target,
  );
