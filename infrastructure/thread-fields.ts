import { type FieldCipher, openJson, openNullable } from "./field-cipher";

/**
 * Opening the sealed columns of threads, turns and answers (#141) wherever a
 * page, route or tool reads them. Each helper opens exactly the columns the
 * caller selected and leaves the rest of the row as it is, so a select stays
 * the one place that says what is read.
 */

export const THREADS = "threads";
export const TURNS = "turns";
export const RESPONSES = "model_responses";

export const openThreadTitle = (
  cipher: FieldCipher,
  threadId: string,
  stored: string,
): string => cipher.openText(THREADS, "title", threadId, stored);

export const openPrompt = (cipher: FieldCipher, turnId: string, stored: string): string =>
  cipher.openText(TURNS, "prompt", turnId, stored);

type SealedResponse = Readonly<{
  id: string;
  text?: string;
  reasoningText?: string | null;
  attribution?: string | null;
  responseDocument?: string | null;
  toolParts?: string | null;
}>;

const JSON_COLUMNS = ["attribution", "responseDocument", "toolParts"] as const;
type JsonColumn = (typeof JSON_COLUMNS)[number];

/** The row with its sealed columns opened; JSON columns become parsed values. */
export type OpenedResponse<T> = {
  [K in keyof T]: K extends JsonColumn ? unknown : T[K];
};

export const openResponse = <T extends SealedResponse>(
  cipher: FieldCipher,
  row: T,
): OpenedResponse<T> => {
  const opened: Record<string, unknown> = { ...row };
  if (row.text !== undefined) {
    opened.text = cipher.openText(RESPONSES, "text", row.id, row.text);
  }
  if (row.reasoningText !== undefined) {
    opened.reasoningText = openNullable(
      cipher,
      RESPONSES,
      "reasoningText",
      row.id,
      row.reasoningText,
    );
  }
  for (const column of JSON_COLUMNS) {
    const stored = row[column];
    if (stored !== undefined) {
      opened[column] =
        stored === null ? null : openJson(cipher, RESPONSES, column, row.id, stored);
    }
  }
  return opened as OpenedResponse<T>;
};
