/**
 * One tool call of an answer as `model_responses."toolParts"` stores it.
 * `features/chat` writes the column and `features/arena` reads it back, so the
 * shape lives here. The hashes are the audit row's (`packages/audit/hash.ts`),
 * so a stored part can be checked against the chain.
 */
export type StoredToolPart = Readonly<{
  /** Position in the turn, from 1. */
  seq: number;
  tool: string;
  input: unknown;
  output: unknown;
  argsSha256: string;
  resultSha256: string;
  /** From the audit row with the same hashes; null when none matched. */
  rowCount: number | null;
  /** When the answer completed, ISO 8601. */
  at: string;
}>;

const isStoredToolPart = (value: unknown): value is StoredToolPart => {
  if (typeof value !== "object" || value === null) return false;
  const part = value as Record<string, unknown>;
  return (
    typeof part.seq === "number" &&
    typeof part.tool === "string" &&
    "input" in part &&
    "output" in part &&
    typeof part.argsSha256 === "string" &&
    typeof part.resultSha256 === "string" &&
    (part.rowCount === null || typeof part.rowCount === "number") &&
    typeof part.at === "string"
  );
};

/** The stored column as parts in seq order; anything else reads as no parts. */
export const toStoredToolParts = (value: unknown): StoredToolPart[] | null => {
  if (!Array.isArray(value) || !value.every(isStoredToolPart)) return null;
  return [...value].sort((a, b) => a.seq - b.seq);
};
