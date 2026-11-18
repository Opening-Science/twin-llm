import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";

import type { SpeechLanguage } from "@/infrastructure/speech/contract";

import type { SpeechEngines } from "./speech-sidecar";

/**
 * The two engines behind the speech sidecar, run as child processes on the
 * CPU: whisper.cpp's `whisper-cli` and Piper's `piper`. Where they are comes
 * from the `voice.json` that `scripts/voice/setup.sh` writes. Text goes to
 * Piper on stdin as one line, never in its arguments (any user on the machine
 * can read those in /proc) and never through a shell. A child gets only PATH
 * and HOME from the environment.
 */

export const voiceSetupSchema = z.object({
  whisper: z.object({
    bin: z.string().min(1),
    model: z.string().min(1),
    threads: z.number().int().positive(),
  }),
  piper: z.object({
    bin: z.string().min(1),
    voices: z.object({ en: z.string().min(1), de: z.string().min(1) }),
  }),
});

export type VoiceSetup = z.infer<typeof voiceSetupSchema>;

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
  run: Run = runProcess,
): SpeechEngines => ({
  health: {
    status: "ok",
    stt: { engine: "whisper.cpp", model: basename(setup.whisper.model) },
    tts: {
      engine: "piper",
      voices: {
        en: voiceName(setup.piper.voices.en),
        de: voiceName(setup.piper.voices.de),
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
  speak: (text: string, language: SpeechLanguage, outPath: string) =>
    checked(
      run,
      setup.piper.bin,
      ["-m", setup.piper.voices[language], "-f", outPath],
      oneLine(text),
    ),
});
