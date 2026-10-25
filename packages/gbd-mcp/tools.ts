import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import { gbdEnv } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";
import type { SessionScope } from "@/packages/query-tools/scope";

import { callTool } from "./client";
import { recordGbdTurn } from "./collector";
import { composeGbdQuestion } from "./compose";
import { GBD_AUDIT_TOOL, GBD_MCP_TOOL, GBD_RELEASE_YEAR } from "./constants";
import type { GbdInput } from "./input";
import { normalizeGbdResult, type GbdRow } from "./normalize";

export type GbdToolPorts = {
  readonly callQuery: (question: string) => Promise<unknown>;
  readonly append: typeof append;
  readonly database: () => PrismaClient;
};

const defaultCallQuery = async (question: string): Promise<unknown> => {
  if (!gbdEnv()) throw new Error("gbd-not-configured");
  return callTool(GBD_MCP_TOOL, { question });
};

export const defaultGbdToolPorts = (): GbdToolPorts => ({
  callQuery: defaultCallQuery,
  append,
  database,
});

export const runGbdPopulation = async (
  scope: SessionScope,
  input: GbdInput,
  ports: GbdToolPorts = defaultGbdToolPorts(),
): Promise<GbdRow[]> => {
  let rows: GbdRow[] = [];
  let result: unknown = [];
  try {
    const raw = await ports.callQuery(composeGbdQuestion(input));
    rows = normalizeGbdResult(raw, input, GBD_RELEASE_YEAR);
    result = rows;
  } catch {
    // A marker only: the error text can carry connector URLs or response bodies.
    rows = [];
    result = { error: "gbd-call-failed" };
  }

  await ports.append(ports.database(), {
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef: null,
    tool: GBD_AUDIT_TOOL,
    args: input,
    result,
    rowCount: rows.length,
  });
  recordGbdTurn(scope.sessionId, { tool: GBD_AUDIT_TOOL, fields: input }, rows);
  return rows;
};
