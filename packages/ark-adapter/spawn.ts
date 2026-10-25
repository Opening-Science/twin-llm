import "server-only";

import { spawn, type ChildProcess } from "node:child_process";

import { GENOME_SOURCE_DISABLED, UNLOCK_FORBIDDEN } from "./codes";
import { arkEnv } from "./hooks";

/**
 * Fixed argv only — never a shell string, never --unlock. GENOME_SOURCE=none
 * refuses here so a stray caller cannot talk to the device. Spawn uses
 * node:child_process so the same path runs under Next's Node runtime.
 */

export const APPROVAL_HOST_SLACK_MS = 90_000;

export type ArkSpawned = {
  readonly kind: "spawned";
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

export type ArkSpawnDisabled = {
  readonly kind: "disabled";
  readonly argv: readonly string[];
  readonly error: { readonly code: string; readonly message: string };
};

export type ArkSpawnResult = ArkSpawned | ArkSpawnDisabled;

export type SpawnArkOptions = {
  readonly hostTimeoutMs?: number;
};

const ALLOWED_PREFIXES: ReadonlyArray<readonly string[]> = [
  ["status"],
  ["data", "list"],
  ["data", "paths"],
  ["app", "run"],
];

export const isAllowedArkCommand = (commandArgv: readonly string[]): boolean =>
  ALLOWED_PREFIXES.some((prefix) =>
    prefix.every((part, index) => commandArgv[index] === part),
  );

export class ArkCommandNotAllowedError extends Error {
  readonly commandArgv: readonly string[];

  constructor(commandArgv: readonly string[]) {
    super(`ark command not allowed: ${commandArgv.join(" ")}`);
    this.name = "ArkCommandNotAllowedError";
    this.commandArgv = commandArgv;
  }
}

export const buildArkArgv = (commandArgv: readonly string[]): string[] => {
  const device = arkEnv().ARK_DEVICE;
  const deviceFlags = device ? ["--device", device] : [];
  return ["ark", ...commandArgv, ...deviceFlags, "--json"];
};

const NODE_SPAWN_OPTIONS = {
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
} as const;

export type ArkNodeSpawn = (
  command: string,
  args: readonly string[],
  options: typeof NODE_SPAWN_OPTIONS,
) => ChildProcess;

let nodeSpawn: ArkNodeSpawn = spawn as ArkNodeSpawn;

/** Test-only. Production always uses node:child_process.spawn. */
export const setArkNodeSpawnForTests = (next: ArkNodeSpawn | null): void => {
  nodeSpawn = next ?? (spawn as ArkNodeSpawn);
};

const collectStream = (stream: NodeJS.ReadableStream | null): Promise<string> =>
  new Promise((resolve) => {
    if (!stream) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const exitCodeFromClose = (
  code: number | null,
  signal: NodeJS.Signals | null,
  timedOut: boolean,
): number => {
  if (code !== null) return code;
  if (timedOut) return 7;
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
};

export const spawnArk = async (
  commandArgv: readonly string[],
  options?: SpawnArkOptions,
): Promise<ArkSpawnResult> => {
  if (!isAllowedArkCommand(commandArgv)) {
    throw new ArkCommandNotAllowedError(commandArgv);
  }

  const argv = buildArkArgv(commandArgv);

  if (arkEnv().GENOME_SOURCE !== "ark") {
    return { kind: "disabled", argv, error: GENOME_SOURCE_DISABLED };
  }

  if (commandArgv.includes("--unlock") || argv.includes("--unlock")) {
    return { kind: "disabled", argv, error: UNLOCK_FORBIDDEN };
  }

  const [command, ...args] = argv;
  const child = nodeSpawn(command, args, NODE_SPAWN_OPTIONS);

  const hostTimeoutMs = options?.hostTimeoutMs;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (hostTimeoutMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, hostTimeoutMs);
  }

  try {
    const [closed, stdout, stderr] = await Promise.all([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        let settled = false;
        const done = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          settled = true;
          resolve({ code, signal });
        };
        child.once("error", () => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          done(1, null);
        });
        child.once("close", (code, signal) => done(code, signal));
      }),
      collectStream(child.stdout),
      collectStream(child.stderr),
    ]);
    return {
      kind: "spawned",
      argv,
      exitCode: exitCodeFromClose(closed.code, closed.signal, timedOut),
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const hostTimeoutMsForCliTimeout = (
  timeoutSeconds?: number,
): number | undefined => {
  if (timeoutSeconds === undefined) return undefined;
  return timeoutSeconds * 1000 + APPROVAL_HOST_SLACK_MS;
};
