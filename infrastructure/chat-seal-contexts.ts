import { type FieldCipher, openJson, sealJson } from "./field-cipher";
import { RESPONSES, THREADS, TURNS } from "./thread-fields";

/**
 * The context each sealed column of conversations, exchanges and answers is
 * sealed under (DATA-MODEL.md B.5). The names are the old tables' and
 * columns', frozen: a value copied from threads, turns or model_responses
 * keeps its ciphertext byte for byte, and with the row id unchanged it opens
 * under the same `<table>.<column>.<row id>` string. New rows written after
 * the switch are sealed under the same names, so the physical names can
 * change again without touching a single sealed value.
 */

export type SealContext = Readonly<{ table: string; column: string }>;

export const CHAT_SEAL_CONTEXTS = {
  conversations: {
    title_sealed: { table: THREADS, column: "title" },
  },
  exchanges: {
    question_sealed: { table: TURNS, column: "prompt" },
    bubble_text_sealed: { table: TURNS, column: "label" },
  },
  answers: {
    body_sealed: { table: RESPONSES, column: "text" },
    reasoning_sealed: { table: RESPONSES, column: "reasoningText" },
    evidence_sealed: { table: RESPONSES, column: "attribution" },
    document_sealed: { table: RESPONSES, column: "responseDocument" },
    tool_trace_sealed: { table: RESPONSES, column: "toolParts" },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, SealContext>>>>;

export type ChatTable = keyof typeof CHAT_SEAL_CONTEXTS;
export type SealedColumn<T extends ChatTable> = keyof (typeof CHAT_SEAL_CONTEXTS)[T];

const contextOf = <T extends ChatTable>(table: T, column: SealedColumn<T>): SealContext =>
  CHAT_SEAL_CONTEXTS[table][column] as SealContext;

/** The frozen context of a sealed chat column named at run time, or null. */
export const sealContextOf = (table: string, column: string): SealContext | null => {
  const tables: Readonly<Record<string, Readonly<Record<string, SealContext>>>> =
    CHAT_SEAL_CONTEXTS;
  if (!Object.hasOwn(tables, table)) return null;
  const columns = tables[table] ?? {};
  return Object.hasOwn(columns, column) ? (columns[column] ?? null) : null;
};

/** Opens a sealed column of the new chat tables under its frozen context. */
export const openChatText = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  stored: string,
): string => {
  const context = contextOf(table, column);
  return cipher.openText(context.table, context.column, rowId, stored);
};

/** Seals a value for a sealed column of the new chat tables under its frozen context. */
export const sealChatText = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  value: string,
): string => {
  const context = contextOf(table, column);
  return cipher.sealText(context.table, context.column, rowId, value);
};

/** `sealChatText` for a column that may be null. */
export const sealChatNullable = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  value: string | null,
): string | null =>
  value === null ? null : sealChatText(cipher, table, column, rowId, value);

/** `openChatText` for a column that may be null. */
export const openChatNullable = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  stored: string | null,
): string | null =>
  stored === null ? null : openChatText(cipher, table, column, rowId, stored);

/** Seals a JSON value (as JSON text) under its frozen context. */
export const sealChatJson = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  value: unknown,
): string => {
  const context = contextOf(table, column);
  return sealJson(cipher, context.table, context.column, rowId, value);
};

/** Opens a sealed JSON column; null when it is null. */
export const openChatJson = <T extends ChatTable>(
  cipher: FieldCipher,
  table: T,
  column: SealedColumn<T>,
  rowId: string,
  stored: string | null,
): unknown => {
  if (stored === null) return null;
  const context = contextOf(table, column);
  return openJson(cipher, context.table, context.column, rowId, stored);
};
