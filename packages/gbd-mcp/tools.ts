import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { database } from "@/infrastructure/database";
import {
  CATEGORY,
  type Disclosure,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
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
  /** Writes the call to the disclosure ledger (#140) before it is sent. */
  readonly recordDisclosure: RecordDisclosure;
  readonly append: typeof append;
  readonly database: () => PrismaClient;
};

const defaultCallQuery = async (question: string): Promise<unknown> => {
  if (!gbdEnv()) throw new Error("gbd-not-configured");
  return callTool(GBD_MCP_TOOL, { question });
};

export const defaultGbdToolPorts = (): GbdToolPorts => ({
  callQuery: defaultCallQuery,
  recordDisclosure,
  append,
  database,
});

/**
 * One question to the remote GBD server. Only synthetic requests reach it
 * (`permitServerForDataMode`), so the row is labelled by the session's mode.
 */
export const gbdDisclosure = (scope: SessionScope, question: string): Disclosure => ({
  actor: scope.actor,
  sessionId: scope.sessionId,
  kind: "remote-tool",
  recipient: "GBD server",
  target: GBD_MCP_TOOL,
  purpose: "population estimate",
  categories: [CATEGORY.population],
  refs: [],
  payloadBytes: Buffer.byteLength(question, "utf8"),
  threadId: null,
  synthetic: scope.mode === "synthetic",
});

/**
 * Looks up one GBD estimate. The question is written to the disclosure
 * ledger first; when that fails the server is not called and the tool
 * returns no rows, marked `gbd-not-recorded`.
 */
export const runGbdPopulation = async (
  scope: SessionScope,
  input: GbdInput,
  ports: GbdToolPorts = defaultGbdToolPorts(),
): Promise<GbdRow[]> => {
  let rows: GbdRow[] = [];
  let result: unknown = [];
  const question = composeGbdQuestion(input);
  const recorded = await ports.recordDisclosure(gbdDisclosure(scope, question)).then(
    () => true,
    () => false,
  );
  if (!recorded) {
    result = { error: "gbd-not-recorded" };
  } else {
    try {
      const raw = await ports.callQuery(question);
      rows = normalizeGbdResult(raw, input, GBD_RELEASE_YEAR);
      result = rows;
    } catch {
      // A marker only: the error text can carry connector URLs or response bodies.
      rows = [];
      result = { error: "gbd-call-failed" };
    }
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
