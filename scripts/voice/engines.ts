import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";

import type { SpeechLanguage } from "@/infrastructure/speech/contract";

import type { SpeechEngines } from "./speech-sidecar";

/**
 * The engines behind the speech sidecar, run as child processes on the CPU.
 * whisper.cpp's `whisper-cli` listens; where it is comes from the `voice.json`
 * that `scripts/voice/setup.sh` writes. The sidecar does not speak by default:
 * answers are read aloud in the browser. Piper (GPL-3.0) is used only when a
 * person installed it themselves and named it in `VOICE_PIPER_BIN`,
 * `VOICE_PIPER_EN` and `VOICE_PIPER_DE`; the repo never fetches it. Text goes
 * to Piper on stdin as one line, never in its arguments (any user on the
 * machine can read those in /proc) and never through a shell. A child gets
 * only PATH and HOME from the environment.
 */

export const voiceSetupSchema = z.object({
  whisper: z.object({
    bin: z.string().min(1),
    model: z.string().min(1),
    threads: z.number().int().positive(),
  }),
});

export type VoiceSetup = z.infer<typeof voiceSetupSchema>;

export type LocalPiper = Readonly<{
  /** The `piper` program, a path or a name on PATH. */
  bin: string;
  /** A voice model (`.onnx`, with its `.onnx.json` beside it) per language. */
  voices: Readonly<Record<SpeechLanguage, string>>;
}>;

const PIPER_ENV = ["VOICE_PIPER_BIN", "VOICE_PIPER_EN", "VOICE_PIPER_DE"] as const;

/**
 * A person's own Piper from the environment: off unless all three are set,
 * and a plain list of what is missing when only some are. Pure.
 */
export const localPiper = (
  env: Readonly<Record<string, string | undefined>>,
):
  | Readonly<{ ok: true; piper: LocalPiper | null }>
  | Readonly<{ ok: false; missing: readonly string[] }> => {
  const value = (name: (typeof PIPER_ENV)[number]) => env[name]?.trim() ?? "";
  const missing = PIPER_ENV.filter((name) => value(name) === "");
  if (missing.length === PIPER_ENV.length) return { ok: true, piper: null };
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    piper: {
      bin: value("VOICE_PIPER_BIN"),
      voices: { en: value("VOICE_PIPER_EN"), de: value("VOICE_PIPER_DE") },
    },
  };
};

export type RunResult = Readonly<{ code: number; stderr: string }>;

export type Run = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<RunResult>;

const STDERR_KEPT = 4000;

export const runProcess: Run = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "ignore", "pipe"],
      env: {
        NODE_ENV: "production",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
      },
    });
    const chunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    // A child that exits early closes the pipe; its exit code says why.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "", "utf8");
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(chunks).toString("utf8").slice(-STDERR_KEPT),
      }),
    );
  });

const checked = async (
  run: Run,
  command: string,
  args: readonly string[],
  input?: string,
) => {
  const result = await run(command, args, input);
  if (result.code !== 0) {
    throw new Error(
      `${basename(command)} exited with ${result.code}: ${result.stderr.trim()}`,
    );
  }
};

/** Piper reads a line at a time, so the answer goes in as one line. */
const oneLine = (text: string): string =>
  `${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}\n`;

/** `de_DE-thorsten-medium.onnx` → `de_DE-thorsten-medium`. */
const voiceName = (path: string): string => basename(path).replace(/\.onnx$/, "");

export const speechEngines = (
  setup: VoiceSetup,
  piper: LocalPiper | null,
  run: Run = runProcess,
): SpeechEngines => ({
  health: {
    status: "ok",
    stt: { engine: "whisper.cpp", model: basename(setup.whisper.model) },
    tts:
      piper === null
        ? null
        : {
            engine: "piper",
            voices: {
              en: voiceName(piper.voices.en),
              de: voiceName(piper.voices.de),
            },
          },
  },
  transcribe: async (wavPath: string, language: SpeechLanguage) => {
    const base = wavPath.replace(/\.wav$/, "");
    await checked(run, setup.whisper.bin, [
      "--model",
      setup.whisper.model,
      "--file",
      wavPath,
      "--language",
      language,
      "--threads",
      String(setup.whisper.threads),
      "--no-timestamps",
      "--no-prints",
      "--output-txt",
      "--output-file",
      base,
    ]);
    return readFile(`${base}.txt`, "utf8");
  },
  speak:
    piper === null
      ? null
      : (text: string, language: SpeechLanguage, outPath: string) =>
          checked(
            run,
            piper.bin,
            ["-m", piper.voices[language], "-f", outPath],
            oneLine(text),
          ),
});
