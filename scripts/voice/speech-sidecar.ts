import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isSpeechLanguage,
  SPEAK_ELAPSED_HEADER,
  speakRequestSchema,
  type SpeechHealth,
  type SpeechLanguage,
} from "@/infrastructure/speech/contract";
import { speechWavProblem, wavInfo } from "@/infrastructure/speech/wav";

/**
 * The speech sidecar (docs/voice.md): the contract in
 * `infrastructure/speech/contract.ts` over two engines that run as child
 * processes, whisper.cpp for speech to text and Piper for text to speech.
 * Each request gets its own folder for the audio files, removed when it ends,
 * so nothing heard or said is kept. The log has the call, the language and
 * the timings, never the text or the audio. An engine's own error goes to the
 * log; the caller gets a plain sentence.
 */

export type SpeechEngines = Readonly<{
  health: SpeechHealth;
  /** The text whisper.cpp heard in a WAV file. */
  transcribe: (wavPath: string, language: SpeechLanguage) => Promise<string>;
  /** Piper writes the spoken text to `outPath` as a WAV file. */
  speak: (text: string, language: SpeechLanguage, outPath: string) => Promise<void>;
}>;

export type SidecarDeps = Readonly<{
  engines: SpeechEngines;
  /** Where each request's folder is made. */
  workDir: string;
  now?: () => number;
  log?: (line: string) => void;
}>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const refuse = (status: 400 | 404 | 500, message: string, type: string): Response =>
  json(status, { error: { message, type } });

/**
 * whisper.cpp marks silence and noise in brackets (`[BLANK_AUDIO]`,
 * `[Music]`, `(wind blowing)`); none of that is something the person said.
 */
export const cleanTranscript = (raw: string): string =>
  raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const inFolder = async <T>(
  workDir: string,
  run: (folder: string) => Promise<T>,
): Promise<T> => {
  const folder = await mkdtemp(join(workDir, "speech-"));
  try {
    return await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

export const createSpeechSidecar = (deps: SidecarDeps) => {
  const now = deps.now ?? (() => performance.now());
  const log = deps.log ?? (() => undefined);

  const transcribe = async (request: Request, url: URL): Promise<Response> => {
    const language = url.searchParams.get("language");
    if (!isSpeechLanguage(language)) {
      return refuse(400, "The language must be en or de.", "invalid_request");
    }
    const audio = new Uint8Array(await request.arrayBuffer());
    if (speechWavProblem(audio) !== null) {
      return refuse(
        400,
        "The audio must be a 16 kHz mono 16-bit WAV file of at most 60 seconds.",
        "invalid_audio",
      );
    }
    const audioMs = wavInfo(audio)?.durationMs ?? 0;
    const started = now();
    try {
      const text = await inFolder(deps.workDir, async (folder) => {
        const path = join(folder, "question.wav");
        await writeFile(path, audio);
        return cleanTranscript(await deps.engines.transcribe(path, language));
      });
      const elapsedMs = Math.round(now() - started);
      log(`transcribe ${language} audio=${audioMs}ms elapsed=${elapsedMs}ms`);
      return json(200, { text, language, audioMs, elapsedMs });
    } catch (error) {
      log(
        `transcribe ${language} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return refuse(500, "Speech to text failed.", "engine_error");
    }
  };

  const speak = async (request: Request): Promise<Response> => {
    const parsed = speakRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return refuse(
        400,
        "The body must be text of at most 2,000 characters and a language, en or de.",
        "invalid_request",
      );
    }
    const { text, language } = parsed.data;
    const started = now();
    try {
      const wav = await inFolder(deps.workDir, async (folder) => {
        const path = join(folder, "answer.wav");
        await deps.engines.speak(text, language, path);
        return new Uint8Array(await readFile(path));
      });
      if (wavInfo(wav) === null) throw new Error("the engine wrote no WAV file");
      const elapsedMs = Math.round(now() - started);
      log(`speak ${language} chars=${text.length} elapsed=${elapsedMs}ms`);
      return new Response(wav, {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          [SPEAK_ELAPSED_HEADER]: String(elapsedMs),
        },
      });
    } catch (error) {
      log(
        `speak ${language} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return refuse(500, "Text to speech failed.", "engine_error");
    }
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, deps.engines.health);
    }
    if (request.method === "POST" && url.pathname === "/v1/transcribe") {
      return transcribe(request, url);
    }
    if (request.method === "POST" && url.pathname === "/v1/speak") return speak(request);
    return refuse(404, "There is no such route.", "not_found");
  };
};
