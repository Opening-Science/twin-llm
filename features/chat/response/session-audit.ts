import type { ResponseToolCall } from "./document-v1";

export type AuditEventRow = Readonly<{
  seq: bigint | number;
  tool: string;
  argsSha256: string;
  resultSha256: string;
  rowCount: number;
  ts: Date;
}>;

export type SessionAuditClient = Readonly<{
  auditEvent: {
    findMany: (args: {
      where: { sessionId: string };
      orderBy: { seq: "asc" };
      select: {
        seq: true;
        tool: true;
        argsSha256: true;
        resultSha256: true;
        rowCount: true;
        ts: true;
      };
    }) => Promise<readonly AuditEventRow[]>;
  };
}>;

export const mapAuditRowsToToolCalls = (
  rows: readonly AuditEventRow[],
): ResponseToolCall[] =>
  rows.map((row) => ({
    seq: Number(row.seq),
    tool: row.tool,
    args_sha256: row.argsSha256,
    result_sha256: row.resultSha256,
    row_count: row.rowCount,
    ts: row.ts.toISOString(),
  }));

export const querySessionAudit = async (
  client: SessionAuditClient,
  turnId: string,
): Promise<readonly ResponseToolCall[]> => {
  const rows = await client.auditEvent.findMany({
    where: { sessionId: turnId },
    orderBy: { seq: "asc" },
    select: {
      seq: true,
      tool: true,
      argsSha256: true,
      resultSha256: true,
      rowCount: true,
      ts: true,
    },
  });
  return mapAuditRowsToToolCalls(rows);
};
