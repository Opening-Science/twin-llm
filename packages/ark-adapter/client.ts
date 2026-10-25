import "server-only";

import { type ArkAuditContext, auditArkCall } from "./audit";
import {
  errorFromExitCode,
  errorFromObject,
  mapArkFailure,
  toArkError,
  type ArkResult,
} from "./codes";
import {
  arkAppRunDocumentSchema,
  arkDataListDocumentSchema,
  arkDataPathsDocumentSchema,
  arkStatusDocumentSchema,
  formatZodIssues,
  isErrorDocument,
  parseJsonValue,
  parseStderrEvents,
  redactStatusDocument,
  stderrErrorObject,
  type ArkAppRunDocument,
  type ArkDataListDocument,
  type ArkDataPathsDocument,
  type ArkStatusSafe,
} from "./schemas";
import { hostTimeoutMsForCliTimeout, spawnArk, type ArkSpawnResult } from "./spawn";

export type { ArkAuditContext };

export type ArkAppRunInput = {
  readonly app: string;
  readonly grants: readonly string[];
  readonly timeout?: number;
};

export type ArkAppRunData = {
  readonly report: string;
};

const parseStdout = (
  stdout: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { ok: false };
  try {
    return { ok: true, value: parseJsonValue(trimmed) };
  } catch {
    return { ok: false };
  }
};

const failureFromSpawned = (spawned: Extract<ArkSpawnResult, { kind: "spawned" }>) => {
  const events = parseStderrEvents(spawned.stderr);
  const parsed = parseStdout(spawned.stdout);
  const fromStdout =
    parsed.ok && isErrorDocument(parsed.value)
      ? errorFromObject(parsed.value.error)
      : null;
  const fromStderr = stderrErrorObject(events);
  if (fromStdout) return mapArkFailure(fromStdout);
  if (fromStderr) return mapArkFailure(errorFromObject(fromStderr));
  if (spawned.timedOut) {
    return mapArkFailure(
      toArkError("timeout", "ark CLI host abort after --timeout plus approval slack"),
    );
  }
  return mapArkFailure(errorFromExitCode(spawned.exitCode));
};

type ParsedOk<T> =
  | { readonly ok: true; readonly data: T; readonly audit: unknown }
  | { readonly ok: false; readonly issues: readonly string[] };

export type ArkAuditArgs = {
  readonly argv: string[];
  readonly grants?: readonly string[];
};

const auditArgsFor = (
  argv: readonly string[],
  grants?: readonly string[],
): ArkAuditArgs =>
  grants === undefined ? { argv: [...argv] } : { argv: [...argv], grants };

const writeAudit = async (
  ctx: ArkAuditContext,
  tool: "ark.status" | "ark.data.list" | "ark.data.paths" | "ark.app.run",
  args: ArkAuditArgs,
  result: unknown,
): Promise<void> => {
  try {
    await auditArkCall(ctx, tool, args, result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`audit failed: ${detail}`);
  }
};

const runCommand = async <T>(
  ctx: ArkAuditContext,
  tool: "ark.status" | "ark.data.list" | "ark.data.paths" | "ark.app.run",
  commandArgv: readonly string[],
  parseOk: (value: unknown) => ParsedOk<T>,
  options?: { readonly hostTimeoutMs?: number; readonly grants?: readonly string[] },
): Promise<ArkResult<T>> => {
  const spawned = await spawnArk(commandArgv, options);
  const args = auditArgsFor(spawned.argv, options?.grants);
  if (spawned.kind === "disabled") {
    const result = mapArkFailure(spawned.error);
    await writeAudit(ctx, tool, args, result.error);
    return result;
  }

  if (spawned.exitCode === 0) {
    const parsed = parseStdout(spawned.stdout);
    const document = parsed.ok
      ? parseOk(parsed.value)
      : {
          ok: false as const,
          issues: ["(root): ark CLI stdout was not valid JSON"],
        };
    if (document.ok) {
      await writeAudit(ctx, tool, args, document.audit);
      return { status: "ok", data: document.data };
    }
    const result = mapArkFailure(
      toArkError(
        "invalid-document",
        "ark CLI stdout was not a valid result document",
        undefined,
        undefined,
        document.issues,
      ),
    );
    await writeAudit(ctx, tool, args, result.error);
    return result;
  }

  const result = failureFromSpawned(spawned);
  await writeAudit(ctx, tool, args, result.error);
  return result;
};

const parseStatus = (value: unknown): ParsedOk<ArkStatusSafe> => {
  const parsed = arkStatusDocumentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error) };
  const data = redactStatusDocument(parsed.data);
  return { ok: true, data, audit: data };
};

const parseDataList = (value: unknown): ParsedOk<ArkDataListDocument> => {
  const parsed = arkDataListDocumentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error) };
  return { ok: true, data: parsed.data, audit: parsed.data };
};

const parseDataPaths = (value: unknown): ParsedOk<ArkDataPathsDocument> => {
  const parsed = arkDataPathsDocumentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error) };
  return { ok: true, data: parsed.data, audit: parsed.data };
};

const reportFromAppRun = (document: ArkAppRunDocument): string => {
  if (document.stdout !== undefined) return document.stdout;
  if (document.stdout_base64 !== undefined) return document.stdout_base64;
  return "";
};

const parseAppRun = (value: unknown): ParsedOk<ArkAppRunData> => {
  const parsed = arkAppRunDocumentSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error) };
  return {
    ok: true,
    data: { report: reportFromAppRun(parsed.data) },
    audit: parsed.data,
  };
};

export const status = (ctx: ArkAuditContext): Promise<ArkResult<ArkStatusSafe>> =>
  runCommand(ctx, "ark.status", ["status"], parseStatus);

export const dataList = (ctx: ArkAuditContext): Promise<ArkResult<ArkDataListDocument>> =>
  runCommand(ctx, "ark.data.list", ["data", "list"], parseDataList);

export const dataPaths = (
  ctx: ArkAuditContext,
): Promise<ArkResult<ArkDataPathsDocument>> =>
  runCommand(ctx, "ark.data.paths", ["data", "paths"], parseDataPaths);

export const appRun = (
  ctx: ArkAuditContext,
  input: ArkAppRunInput,
): Promise<ArkResult<ArkAppRunData>> => {
  const commandArgv =
    input.timeout === undefined
      ? (["app", "run", input.app] as const)
      : (["app", "run", input.app, "--timeout", String(input.timeout)] as const);
  return runCommand(ctx, "ark.app.run", commandArgv, parseAppRun, {
    hostTimeoutMs: hostTimeoutMsForCliTimeout(input.timeout),
    grants: input.grants,
  });
};
