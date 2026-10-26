import type { StoredToolPart } from "@/infrastructure/model-response-tool-parts";
import type { ResponseToolCall } from "@/infrastructure/response-document/document-v1";
import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";

/**
 * The turn's tool results as the row stores them. Each part is hashed the way
 * the audit row was, and the audit row with the same hashes lends its row
 * count. Audit tool names can differ from model tool names, so the match is
 * by hashes alone, and a row is used once.
 */
export type ToolResultLike = Readonly<{
  toolName: string;
  input: unknown;
  output: unknown;
}>;

export const storedToolParts = (
  results: readonly ToolResultLike[],
  auditCalls: readonly ResponseToolCall[],
  at: Date,
): StoredToolPart[] | null => {
  if (results.length === 0) return null;
  const unused = [...auditCalls];
  return results.map((result, index) => {
    const argsSha256 = sha256Hex(toCanonicalJson(result.input));
    const resultSha256 = sha256Hex(toCanonicalJson(result.output));
    const match = unused.findIndex(
      (call) => call.args_sha256 === argsSha256 && call.result_sha256 === resultSha256,
    );
    const rowCount =
      match === -1 ? null : (unused.splice(match, 1)[0]?.row_count ?? null);
    return {
      seq: index + 1,
      tool: result.toolName,
      input: result.input,
      output: result.output,
      argsSha256,
      resultSha256,
      rowCount,
      at: at.toISOString(),
    };
  });
};
