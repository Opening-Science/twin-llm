import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { zipSync } from "fflate";

import { type SyntheaEnv } from "@/infrastructure/env";

import {
  buildSyntheaCommand,
  buildSyntheaProperties,
  RUN_README,
  runManifest,
} from "./synthea-args";
import { SYNTHEA_JAR_SHA256 } from "./synthea-options";
import {
  isPatientFile,
  progressFromChunk,
  summarisePatientBundle,
} from "./synthea-output";
import { type RunInput, type RunOutcome } from "./synthea-queue";

/**
 * The I/O half of the generator: the JAR check, the Java process, the job
 * folder and the zip. Synthea is a Java program, so it can only run here on
 * the server. The process gets an argument array (no shell) built by
 * `synthea-args.ts`, and an environment with PATH, TZ and LANG only, so no
 * server secret reaches it. Output stays in the job's temporary folder until
 * the queue removes it.
 */

const ZIP_NAME = "synthea.zip";
const CONFIG_NAME = "synthea.properties";
/** Lines of Synthea's output kept for the server log when a run fails. */
const LOG_TAIL = 20;

export const defaultJarPath = (): string =>
  resolve(process.cwd(), ".synthea/cache/synthea-with-dependencies.jar");

export const jarPathOf = (env: SyntheaEnv): string => env.jarPath ?? defaultJarPath();

const sha256OfFile = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

export type JarStatus = "ready" | "missing" | "checksum-mismatch";

const jarCache = new Map<string, Promise<JarStatus>>();

/** Whether the pinned JAR is in place; a good answer is kept for the process. */
export const checkJar = (path: string): Promise<JarStatus> => {
  const cached = jarCache.get(path);
  if (cached !== undefined) return cached;
  const checking = (async (): Promise<JarStatus> => {
    const found = await stat(path).catch(() => null);
    if (found === null || !found.isFile()) return "missing";
    return (await sha256OfFile(path)) === SYNTHEA_JAR_SHA256
      ? "ready"
      : "checksum-mismatch";
  })();
  // Only "ready" is remembered, so a JAR put in place later is picked up.
  void checking.then((status) => {
    if (status === "ready") jarCache.set(path, checking);
  });
  return checking;
};

export const makeJobDir = (): Promise<string> => mkdtemp(join(tmpdir(), "synthea-job-"));

export const removeJobDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true });

export const readJobZip = async (dir: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(join(dir, ZIP_NAME)));

const listFiles = async (dir: string): Promise<readonly string[]> =>
  (await readdir(dir).catch(() => [] as string[])).sort();

type ProcessResult = Readonly<{ code: number | null; tail: readonly string[] }>;

const runJava = (
  env: SyntheaEnv,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<ProcessResult> =>
  new Promise((done, fail) => {
    const child = spawn(env.javaBin, args, {
      cwd,
      // NODE_ENV only satisfies the ProcessEnv type; Java ignores it.
      env: { PATH: env.childPath, TZ: "UTC", LANG: "C.UTF-8", NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const tail: string[] = [];
    const keep = (text: string) => {
      // A bounded buffer of recent lines for the server log; the push is the point.
      tail.push(...text.split(/\r?\n/).filter(Boolean));
      tail.splice(0, Math.max(0, tail.length - LOG_TAIL));
    };
    const kill = () => child.kill("SIGKILL");
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.setEncoding("utf8").on("data", (text: string) => {
      keep(text);
      onChunk(text);
    });
    child.stderr.setEncoding("utf8").on("data", keep);
    child.on("error", (error) => {
      signal.removeEventListener("abort", kill);
      fail(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      done({ code, tail });
    });
    if (signal.aborted) kill();
  });

const zipEntries = async (
  dir: string,
  folder: "fhir" | "csv",
  keep: (name: string) => boolean,
): Promise<ReadonlyArray<readonly [string, Uint8Array]>> => {
  const names = (await listFiles(join(dir, folder))).filter(keep);
  return Promise.all(
    names.map(
      async (name) =>
        [
          `${folder}/${name}`,
          new Uint8Array(await readFile(join(dir, folder, name))),
        ] as const,
    ),
  );
};

/** Runs Synthea for one job in its folder and leaves `synthea.zip` there. */
export const runSyntheaJob =
  (env: SyntheaEnv) =>
  async (
    input: RunInput,
    signal: AbortSignal,
    onProgress: (done: number) => void,
  ): Promise<RunOutcome> => {
    const jarPath = jarPathOf(env);
    if ((await checkJar(jarPath)) !== "ready") {
      console.error("[synthea] the pinned Synthea JAR is missing or does not match");
      return { ok: false };
    }
    const configPath = join(input.dir, CONFIG_NAME);
    await writeFile(configPath, buildSyntheaProperties(input.options.formats));
    const command = buildSyntheaCommand(input.options, input.seed, {
      jarPath,
      configPath,
      pathDelimiter: delimiter,
    });
    const result = await runJava(env, command.args, input.dir, signal, (text) => {
      const done = progressFromChunk(text);
      if (done !== null) onProgress(Math.min(done, input.options.people));
    });
    if (signal.aborted) return { ok: false };
    if (result.code !== 0) {
      console.error(`[synthea] run ${input.id} exited with ${String(result.code)}`, {
        tail: result.tail,
      });
      return { ok: false };
    }

    const fhir = await zipEntries(input.dir, "fhir", isPatientFile);
    const csv = await zipEntries(input.dir, "csv", (name) => name.endsWith(".csv"));
    const patientFiles = fhir.length;
    const firstBundle = fhir[0]?.[1];
    const preview =
      firstBundle === undefined
        ? null
        : summarisePatientBundle(JSON.parse(new TextDecoder().decode(firstBundle)));
    const encoder = new TextEncoder();
    const zipped = zipSync(
      Object.fromEntries([
        ["README.txt", encoder.encode(RUN_README)],
        [
          "manifest.json",
          encoder.encode(runManifest(input.options, command, patientFiles)),
        ],
        ...fhir,
        ...csv,
      ]),
      { level: 6 },
    );
    await writeFile(join(input.dir, ZIP_NAME), zipped);
    return { ok: true, patientFiles, preview };
  };
