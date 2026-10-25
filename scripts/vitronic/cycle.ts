/**
 * Host-only BodyLoop cycle CLI. The TwinLLM app never imports this file.
 * Default is dry-run (print method + path + body shape, no network write).
 * --execute logs in with BODYLOOP_* from .env.local and performs the write.
 *
 * Scan-create parameters: the example scan request in BodyLoop API 0.13.7
 * (endpoints: docs/vitronic-endpoints.md). Shape:
 * .open-twin/packages/provider-vitronic/src/api/schemas/viatars.ts
 * ViatarRequestSchema lines 50–106. open-twin pin 130e3f64 has no
 * exampleViatarRequest.
 *
 * Usage:
 *   bun scripts/vitronic/cycle.ts create-proband --key-external <pseudonym>
 *   bun scripts/vitronic/cycle.ts create-scan --proband-id <n> --execute
 *   bun scripts/vitronic/cycle.ts start --viatar-id <n> --target analyzed_avatar_3d --execute
 */
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  append,
  type AppendedEvent,
  type AppendInput,
} from "../../packages/audit/append";
import { assertAllowedGetPath, viatarPath } from "../../packages/vitronic/paths";
import {
  pinnedRequest,
  TlsPinMismatchError,
  type PinnedRequestInit,
  type PinnedRequestResult,
  type TlsPinMode,
} from "../../packages/vitronic/tls";
import {
  assertAllowedWrite,
  writeScanSubjectCreatePath,
  writeViatarCreatePath,
  writeViatarTargetsPath,
} from "../../packages/vitronic/write-paths";

import { loadDotEnvLocal, type MintEnv, type MintIo } from "./mint-token";

const LOGIN_PATH = "/api/v2/authentification/token";
const ANALYZED_TARGET = "analyzed_avatar_3d";
const VIATAR_GET_TEMPLATE = "/api/v2/viatars/{id}";
const VIATAR_TARGETS_TEMPLATE = "/api/v2/viatars/{id}/targets/";

export const CONFIRM_LINE = "yes, the person is in position";
export const CONFIRM_PROMPT =
  'Type "yes, the person is in position" and press Enter to start the scan (anything else aborts):';
export const COUNTDOWN_MS = 10_000;
export const POLL_INTERVAL_MS = 5_000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export const CYCLE_AUDIT_ACTOR = "vitronic-cycle";
export const CYCLE_AUDIT_SESSION = "vitronic-cycle";
export const CYCLE_AUDIT_TOOL_LOGIN = "vitronic.cycle.login";
export const CYCLE_AUDIT_TOOL_CREATE_PROBAND = "vitronic.cycle.create_proband";
export const CYCLE_AUDIT_TOOL_CREATE_SCAN = "vitronic.cycle.create_scan";
export const CYCLE_AUDIT_TOOL_START = "vitronic.cycle.start";
export const CYCLE_AUDIT_TOOL_POLL = "vitronic.cycle.poll";

export const CYCLE_ERROR = {
  AUDIT_APPEND_FAILED: "AUDIT_APPEND_FAILED",
  AUDIT_PORT_UNAVAILABLE: "AUDIT_PORT_UNAVAILABLE",
  HTTP_FAILED: "HTTP_FAILED",
  LOGIN_FAILED: "LOGIN_FAILED",
  TLS_PIN_MISMATCH: "TLS_PIN_MISMATCH",
  TLS_PIN_REQUIRED: "TLS_PIN_REQUIRED",
} as const;

export const BANNED_SCAN_SUBJECT_FIELDS = [
  "name",
  "name_given",
  "name_family",
  "date_of_birth",
  "gender",
  "contact",
  "address",
  "note",
] as const;

const BANNED_CLI_FLAGS = [
  "--name",
  "--name-given",
  "--name-family",
  "--date-of-birth",
  "--gender",
  "--contact",
  "--address",
  "--note",
] as const;

/** Default create-scan parameters, from the example scan request in BodyLoop API 0.13.7. */
export const DEFAULT_VIATAR_PARAMETERS = {
  analyzed_avatar_3d: {
    orphaned_palpation_marker: true,
    palp_snap_distance: 0.05,
    preset_id: -1,
  },
  avatar_3d: {
    clothing: "Tight",
    model: "No Model",
    reverse: false,
  },
  imageset_2d: {
    exposure_time: 30000,
    keep_images: false,
    projector_brightness: 83,
    ring_brightness: 40,
  },
  mesh_3d: {
    detail: "High",
    texture: true,
  },
  observations: {
    weight: {},
  },
  report: {
    preset: "Default",
  },
  title: "",
} as const;

export type CycleHttp = (
  url: string,
  init: PinnedRequestInit,
  mode: TlsPinMode,
) => Promise<PinnedRequestResult>;

/**
 * Mockable audit append. Shape matches the scanner-read call at
 * features/vitronic/connection.ts:485-493 (tool, hashed args/results via
 * packages/audit/append, row_count).
 */
export type CycleAuditAppend = (input: AppendInput) => Promise<AppendedEvent>;

export type CyclePorts = Readonly<{
  http?: CycleHttp;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  readLine?: () => Promise<string>;
  audit?: CycleAuditAppend;
  createAudit?: (env: MintEnv) => Promise<CycleAuditAppend>;
}>;

const origin = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const pinModeFromEnv = (fingerprint: string | undefined): TlsPinMode => {
  if (fingerprint && fingerprint.length > 0) {
    return { kind: "pin", fingerprintSha256: fingerprint };
  }
  return { kind: "tofu" };
};

const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
};

const bodyShape = (body: object): string => `{ ${Object.keys(body).join(", ")} }`;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultReadLine = async (): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve) => {
      rl.once("line", (line) => resolve(line));
    });
  } finally {
    rl.close();
  }
};

export const scanSubjectCreateBody = (
  keyExternal: string,
): { readonly key_external: string } => ({ key_external: keyExternal });

export const assertScanSubjectCreateBody = (body: Record<string, unknown>): void => {
  for (const field of BANNED_SCAN_SUBJECT_FIELDS) {
    if (Object.hasOwn(body, field)) {
      throw new Error("vitronic-scan-subject-field-rejected");
    }
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "key_external") {
    throw new Error("vitronic-scan-subject-field-rejected");
  }
  if (typeof body.key_external !== "string" || body.key_external.length === 0) {
    throw new Error("vitronic-scan-subject-field-rejected");
  }
};

const rejectBannedCliFlags = (argv: readonly string[]): void => {
  for (const flag of BANNED_CLI_FLAGS) {
    if (argv.includes(flag)) {
      throw new Error("vitronic-scan-subject-field-rejected");
    }
  }
};

const logWrite = (io: MintIo, method: string, path: string): void => {
  io.stderr.write(`${method} ${path}\n`);
};

const printDryRun = (io: MintIo, method: string, path: string, body: object): void => {
  io.stdout.write(`${method} ${path}\n${bodyShape(body)}\n`);
};

const printCycleError = (io: MintIo, code: string, message: string): void => {
  io.stderr.write(`${code}: ${message}\n`);
};

const isTlsPinMismatch = (error: unknown): boolean => {
  if (error instanceof TlsPinMismatchError) return true;
  return error instanceof Error && error.name === "TlsPinMismatchError";
};

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

const printCaught = (io: MintIo, error: unknown): void => {
  if (error instanceof Error && error.message === "AUDIT_APPEND_FAILED") return;
  if (error instanceof Error && error.message === "AUDIT_PORT_UNAVAILABLE") {
    printCycleError(
      io,
      CYCLE_ERROR.AUDIT_PORT_UNAVAILABLE,
      "cannot construct the audit port (DATABASE_URL required; server-only modules are not used).",
    );
    return;
  }
  if (isTlsPinMismatch(error)) {
    printCycleError(io, CYCLE_ERROR.TLS_PIN_MISMATCH, "TLS pin did not match.");
    return;
  }
  if (error instanceof Error && error.message === "vitronic-cycle-env") {
    io.stderr.write(
      "BODYLOOP_BASE_URL, BODYLOOP_USERNAME, and BODYLOOP_PASSWORD are required.\n",
    );
    return;
  }
  if (error instanceof Error && error.message === "vitronic-cycle-login") {
    printCycleError(io, CYCLE_ERROR.LOGIN_FAILED, "scanner login failed.");
    return;
  }
  printCycleError(io, CYCLE_ERROR.HTTP_FAILED, "scanner request failed.");
};

const integerField = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
};

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const cycleAuditInput = (
  tool: string,
  args: unknown,
  result: unknown,
  rowCount: number,
): AppendInput => ({
  actor: CYCLE_AUDIT_ACTOR,
  sessionId: CYCLE_AUDIT_SESSION,
  subjectRef: null,
  tool,
  args,
  result,
  rowCount,
});

const defaultCreateAudit = async (env: MintEnv): Promise<CycleAuditAppend> => {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error("AUDIT_PORT_UNAVAILABLE");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  return (input: AppendInput) => append(client, input);
};

const resolveAudit = async (
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts,
): Promise<CycleAuditAppend | null> => {
  if (ports.audit) return ports.audit;
  try {
    const factory = ports.createAudit ?? defaultCreateAudit;
    return await factory(env);
  } catch {
    printCycleError(
      io,
      CYCLE_ERROR.AUDIT_PORT_UNAVAILABLE,
      "cannot construct the audit port (DATABASE_URL required; server-only modules are not used).",
    );
    return null;
  }
};

const requireExecutePin = (env: MintEnv, io: MintIo): boolean => {
  const mode = pinModeFromEnv(env.BODYLOOP_TLS_FINGERPRINT?.trim());
  if (mode.kind === "pin") return true;
  printCycleError(
    io,
    CYCLE_ERROR.TLS_PIN_REQUIRED,
    "set BODYLOOP_TLS_FINGERPRINT to the full SHA-256 from VitronicConnection.tlsFingerprintSha256, never the 12-char prefix bun run vitronic:connect prints.",
  );
  return false;
};

const appendAudit = async (
  audit: CycleAuditAppend,
  io: MintIo,
  scannerWriteHappened: boolean,
  input: AppendInput,
): Promise<void> => {
  try {
    await audit(input);
  } catch {
    if (!scannerWriteHappened) return;
    printCycleError(
      io,
      CYCLE_ERROR.AUDIT_APPEND_FAILED,
      "scanner write succeeded; audit append failed.",
    );
    throw new Error("AUDIT_APPEND_FAILED");
  }
};

const login = async (
  env: MintEnv,
  ports: CyclePorts,
  io: MintIo,
  audit: CycleAuditAppend,
): Promise<{
  readonly base: string;
  readonly token: string;
  readonly mode: TlsPinMode;
}> => {
  const baseUrl = env.BODYLOOP_BASE_URL?.trim();
  const username = env.BODYLOOP_USERNAME?.trim();
  const password = env.BODYLOOP_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error("vitronic-cycle-env");
  }
  const mode = pinModeFromEnv(env.BODYLOOP_TLS_FINGERPRINT?.trim());
  const http = ports.http ?? pinnedRequest;
  const loginBody = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    scope: "admin",
  }).toString();
  const loginArgs = { method: "POST", path: LOGIN_PATH };
  let result: PinnedRequestResult;
  try {
    result = await http(
      `${origin(baseUrl)}${LOGIN_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: loginBody,
      },
      mode,
    );
  } catch (error) {
    await appendAudit(
      audit,
      io,
      false,
      cycleAuditInput(
        CYCLE_AUDIT_TOOL_LOGIN,
        loginArgs,
        {
          error: isTlsPinMismatch(error)
            ? CYCLE_ERROR.TLS_PIN_MISMATCH
            : CYCLE_ERROR.HTTP_FAILED,
        },
        0,
      ),
    );
    throw error;
  }
  const parsed = parseJsonObject(result.body.toString("utf8"));
  const token =
    parsed && typeof parsed.access_token === "string" ? parsed.access_token : null;
  const loginSucceeded = isSuccessStatus(result.status) && token !== null;
  await appendAudit(
    audit,
    io,
    loginSucceeded,
    cycleAuditInput(CYCLE_AUDIT_TOOL_LOGIN, loginArgs, { status: result.status }, 0),
  );
  if (!loginSucceeded) throw new Error("vitronic-cycle-login");
  return { base: origin(baseUrl), token, mode };
};

const writeJson = async (
  ports: CyclePorts,
  io: MintIo,
  session: { readonly base: string; readonly token: string; readonly mode: TlsPinMode },
  path: string,
  body: object,
): Promise<PinnedRequestResult> => {
  assertAllowedWrite("POST", path);
  logWrite(io, "POST", path);
  const http = ports.http ?? pinnedRequest;
  return http(
    `${session.base}${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    session.mode,
  );
};

const writeJsonAndAudit = async (
  ports: CyclePorts,
  io: MintIo,
  audit: CycleAuditAppend,
  session: { readonly base: string; readonly token: string; readonly mode: TlsPinMode },
  path: string,
  pathTemplate: string,
  tool: string,
  body: object,
): Promise<PinnedRequestResult> => {
  let result: PinnedRequestResult;
  try {
    result = await writeJson(ports, io, session, path, body);
  } catch (error) {
    await appendAudit(
      audit,
      io,
      false,
      cycleAuditInput(
        tool,
        { method: "POST", path: pathTemplate },
        {
          error: isTlsPinMismatch(error)
            ? CYCLE_ERROR.TLS_PIN_MISMATCH
            : CYCLE_ERROR.HTTP_FAILED,
        },
        0,
      ),
    );
    throw error;
  }
  await appendAudit(
    audit,
    io,
    isSuccessStatus(result.status),
    cycleAuditInput(
      tool,
      { method: "POST", path: pathTemplate },
      { status: result.status },
      0,
    ),
  );
  if (result.status < 200 || result.status >= 300) {
    printCycleError(io, CYCLE_ERROR.HTTP_FAILED, "scanner request failed.");
  }
  return result;
};

export const targetPollOutcome = (
  status: string | null | undefined,
): "ready" | "error" | "wait" => {
  if (status === "Ready") return "ready";
  if (status === "Failed" || status === "Aborted") return "error";
  return "wait";
};

const readTargetState = (
  payload: Record<string, unknown>,
  target: string,
): { readonly status: string | null; readonly progress: number | null } => {
  const targets = payload.targets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    return { status: null, progress: null };
  }
  const row = (targets as Record<string, unknown>)[target];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { status: null, progress: null };
  }
  const state = (row as { state?: unknown }).state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { status: null, progress: null };
  }
  const rec = state as { status?: unknown; progress?: unknown };
  const status = typeof rec.status === "string" ? rec.status : null;
  const progress =
    typeof rec.progress === "number" && Number.isFinite(rec.progress)
      ? rec.progress
      : null;
  return { status, progress };
};

const pollTarget = async (
  ports: CyclePorts,
  io: MintIo,
  audit: CycleAuditAppend,
  session: { readonly base: string; readonly token: string; readonly mode: TlsPinMode },
  viatarId: number,
  target: string,
): Promise<number> => {
  const path = viatarPath(viatarId);
  assertAllowedGetPath(path);
  const http = ports.http ?? pinnedRequest;
  const sleep = ports.sleep ?? defaultSleep;
  const now = ports.now ?? Date.now;
  const deadline = now() + POLL_TIMEOUT_MS;
  const pollArgs = { method: "GET", path: VIATAR_GET_TEMPLATE };

  const finish = async (
    exitCode: number,
    ticks: number,
    state: string,
    writeSucceeded: boolean,
  ): Promise<number> => {
    try {
      await appendAudit(
        audit,
        io,
        writeSucceeded,
        cycleAuditInput(
          CYCLE_AUDIT_TOOL_POLL,
          pollArgs,
          { ticks, state, exit_code: exitCode },
          ticks,
        ),
      );
    } catch {
      return 1;
    }
    return exitCode;
  };

  let ticks = 0;
  try {
    while (now() <= deadline) {
      ticks += 1;
      const result = await http(
        `${session.base}${path}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${session.token}`,
            accept: "application/json",
          },
        },
        session.mode,
      );
      if (!isSuccessStatus(result.status)) {
        printCycleError(io, CYCLE_ERROR.HTTP_FAILED, "scanner request failed.");
        return finish(1, ticks, "http_error", false);
      }
      const payload = parseJsonObject(result.body.toString("utf8"));
      if (!payload) return finish(1, ticks, "parse_error", true);
      const { status, progress } = readTargetState(payload, target);
      const progressText = progress === null ? "" : ` ${progress}`;
      io.stdout.write(`${target}${progressText}\n`);
      const outcome = targetPollOutcome(status);
      if (outcome === "ready") return finish(0, ticks, status ?? "Ready", true);
      if (outcome === "error") return finish(1, ticks, status ?? "error", true);
      if (now() + POLL_INTERVAL_MS > deadline) break;
      await sleep(POLL_INTERVAL_MS);
    }
    return finish(2, ticks, "timeout", ticks > 0);
  } catch (error) {
    printCaught(io, error);
    return finish(
      1,
      ticks,
      isTlsPinMismatch(error) ? CYCLE_ERROR.TLS_PIN_MISMATCH : "error",
      false,
    );
  }
};

const countdown = async (ports: CyclePorts, io: MintIo): Promise<void> => {
  const sleep = ports.sleep ?? defaultSleep;
  for (let remaining = COUNTDOWN_MS / 1000; remaining > 0; remaining -= 1) {
    io.stderr.write(`${remaining}\n`);
    await sleep(1000);
  }
};

const requireAudit = (ports: CyclePorts): CycleAuditAppend => {
  if (!ports.audit) throw new Error("AUDIT_PORT_UNAVAILABLE");
  return ports.audit;
};

const runCreateScanSubject = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts,
  execute: boolean,
): Promise<number> => {
  rejectBannedCliFlags(argv);
  const keyExternal = flagValue(argv, "--key-external");
  if (!keyExternal) {
    io.stderr.write("create-proband requires --key-external.\n");
    return 1;
  }
  const body = scanSubjectCreateBody(keyExternal);
  assertScanSubjectCreateBody({ ...body });
  const path = writeScanSubjectCreatePath();
  if (!execute) {
    printDryRun(io, "POST", path, body);
    return 0;
  }
  try {
    const audit = requireAudit(ports);
    const session = await login(env, ports, io, audit);
    const result = await writeJsonAndAudit(
      ports,
      io,
      audit,
      session,
      path,
      path,
      CYCLE_AUDIT_TOOL_CREATE_PROBAND,
      body,
    );
    if (result.status < 200 || result.status >= 300) return 1;
    const parsed = parseJsonObject(result.body.toString("utf8"));
    const id = parsed ? integerField(parsed.proband_id) : null;
    if (id === null) return 1;
    io.stdout.write(`${id}\n`);
    return 0;
  } catch (error) {
    printCaught(io, error);
    return 1;
  }
};

const runCreateScan = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts,
  execute: boolean,
): Promise<number> => {
  const rawId = flagValue(argv, "--proband-id");
  const probandId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
  if (!Number.isInteger(probandId) || probandId < 1) {
    io.stderr.write("create-scan requires --proband-id.\n");
    return 1;
  }
  const body = { proband_id: probandId, parameters: DEFAULT_VIATAR_PARAMETERS };
  const path = writeViatarCreatePath();
  if (!execute) {
    printDryRun(io, "POST", path, body);
    return 0;
  }
  try {
    const audit = requireAudit(ports);
    const session = await login(env, ports, io, audit);
    const result = await writeJsonAndAudit(
      ports,
      io,
      audit,
      session,
      path,
      path,
      CYCLE_AUDIT_TOOL_CREATE_SCAN,
      body,
    );
    if (result.status < 200 || result.status >= 300) return 1;
    const parsed = parseJsonObject(result.body.toString("utf8"));
    const id = parsed ? integerField(parsed.viatar_id) : null;
    if (id === null) return 1;
    io.stdout.write(`${id}\n`);
    return 0;
  } catch (error) {
    printCaught(io, error);
    return 1;
  }
};

const runStart = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts,
  execute: boolean,
): Promise<number> => {
  const rawId = flagValue(argv, "--viatar-id");
  const viatarId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
  const target = flagValue(argv, "--target");
  if (!Number.isInteger(viatarId) || viatarId < 1 || target !== ANALYZED_TARGET) {
    io.stderr.write("start requires --viatar-id and --target analyzed_avatar_3d.\n");
    return 1;
  }
  const body = { target_kind: ANALYZED_TARGET };
  const path = writeViatarTargetsPath(viatarId);
  if (!execute) {
    printDryRun(io, "POST", path, body);
    return 0;
  }
  const readLine = ports.readLine ?? defaultReadLine;
  io.stderr.write(`${CONFIRM_PROMPT}\n`);
  const line = await readLine();
  if (line !== CONFIRM_LINE) {
    io.stderr.write("Confirmation did not match.\n");
    return 1;
  }
  await countdown(ports, io);
  try {
    const audit = requireAudit(ports);
    const session = await login(env, ports, io, audit);
    const result = await writeJsonAndAudit(
      ports,
      io,
      audit,
      session,
      path,
      VIATAR_TARGETS_TEMPLATE,
      CYCLE_AUDIT_TOOL_START,
      body,
    );
    if (result.status < 200 || result.status >= 300) return 1;
    return pollTarget(ports, io, audit, session, viatarId, ANALYZED_TARGET);
  } catch (error) {
    printCaught(io, error);
    return 1;
  }
};

const prepareExecutePorts = async (
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts,
): Promise<CyclePorts | null> => {
  const audit = await resolveAudit(env, io, ports);
  if (!audit) return null;
  if (!requireExecutePin(env, io)) return null;
  return { ...ports, audit };
};

export const runCycle = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
  ports: CyclePorts = {},
): Promise<number> => {
  const execute = argv.includes("--execute");
  const positional = argv.filter((part, index) => {
    if (part.startsWith("--")) return false;
    const prev = argv[index - 1];
    if (prev?.startsWith("--") && prev !== "--execute") return false;
    return true;
  });
  const sub = positional[0];
  const prepared = execute ? await prepareExecutePorts(env, io, ports) : ports;
  if (!prepared) return 1;
  try {
    if (sub === "create-proband")
      return await runCreateScanSubject(argv, env, io, prepared, execute);
    if (sub === "create-scan")
      return await runCreateScan(argv, env, io, prepared, execute);
    if (sub === "start") return await runStart(argv, env, io, prepared, execute);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "vitronic-scan-subject-field-rejected"
    ) {
      io.stderr.write("create-proband rejects fields other than key_external.\n");
      return 1;
    }
    throw error;
  }
  io.stderr.write("Usage: cycle create-proband | create-scan | start\n");
  return 1;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fileEnv = loadDotEnvLocal(root);
  const env: MintEnv = { ...fileEnv, ...process.env };
  const code = await runCycle(process.argv.slice(2), env, process);
  process.exit(code);
}
