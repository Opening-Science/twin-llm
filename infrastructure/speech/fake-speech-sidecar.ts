import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  SPEAK_ELAPSED_HEADER,
  type SpeechHealth,
  type SpeechLanguage,
  isSpeechLanguage,
  speakRequestSchema,
} from "./contract";
import { encodeWav, speechWavProblem, wavInfo } from "./wav";

/**
 * A stand-in for the speech sidecar's contract on 127.0.0.1, for tests and
 * local screenshots, so nothing needs whisper.cpp, a local voice or a model. It
 * answers every question with a fixed sentence per language, speaks a short
 * quiet tone, and records what it received so a test can check exactly what
 * arrived. It checks its input the way the real sidecar does.
 */

export const FAKE_TRANSCRIPTS: Readonly<Record<SpeechLanguage, string>> = {
  en: "Show me my heart.",
  de: "Zeig mir mein Herz.",
};

export const FAKE_SPEECH_HEALTH: SpeechHealth = {
  status: "ok",
  stt: { engine: "fake", model: "fixed sentences" },
  tts: { engine: "fake", voices: { en: "fake-en", de: "fake-de" } },
};

export type FakeSpeechCall =
  | Readonly<{ kind: "transcribe"; language: string; audioMs: number }>
  | Readonly<{ kind: "speak"; language: string; text: string }>;

export type FakeSpeechSidecar = Readonly<{
  baseUrl: string;
  received: FakeSpeechCall[];
  stop: () => void;
}>;

export type FakeSpeechOptions = Readonly<{
  /** Answer every call with this status and an error body instead. */
  status?: number;
  delayMs?: number;
  /** Answer every call with a 307 to this address instead. */
  redirectTo?: string;
  /** Only listen, as the real sidecar does without a local voice. */
  listenOnly?: boolean;
  /** Replace the fixed sentences, such as "" to test nothing heard. */
  transcripts?: Readonly<Partial<Record<SpeechLanguage, string>>>;
  host?: string;
  port?: number;
}>;

const readBody = (request: IncomingMessage): Promise<Uint8Array> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const sendError = (response: ServerResponse, status: number, type: string) =>
  sendJson(response, status, {
    error: { message: "The fake sidecar refused this request.", type },
  });

const jsonOrNull = (body: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
};

/** A quarter second of a quiet 440 Hz tone at the sidecar's rate. */
const toneWav = (): Uint8Array =>
  encodeWav(
    Float32Array.from(
      { length: 4000 },
      (_, index) => Math.sin((2 * Math.PI * 440 * index) / 16_000) * 0.1,
    ),
  );

export const startFakeSpeechSidecar = async (
  options: FakeSpeechOptions = {},
): Promise<FakeSpeechSidecar> => {
  const received: FakeSpeechCall[] = [];
  const transcripts = { ...FAKE_TRANSCRIPTS, ...options.transcripts };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (options.redirectTo !== undefined) {
      response.writeHead(307, {
        location: `${options.redirectTo}${url.pathname}${url.search}`,
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(
        response,
        200,
        options.listenOnly === true
          ? { ...FAKE_SPEECH_HEALTH, tts: null }
          : FAKE_SPEECH_HEALTH,
      );
      return;
    }
    void readBody(request).then(async (body) => {
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.status !== undefined && options.status !== 200) {
        response.writeHead(options.status, { "content-type": "text/plain" });
        response.end("fake sidecar: model file missing at /models/x.bin");
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/transcribe") {
        const language = url.searchParams.get("language") ?? "";
        if (!isSpeechLanguage(language) || speechWavProblem(body) !== null) {
          sendError(response, 400, "invalid_request");
          return;
        }
        const audioMs = wavInfo(body)?.durationMs ?? 0;
        received.push({ kind: "transcribe", language, audioMs });
        sendJson(response, 200, {
          text: transcripts[language],
          language,
          audioMs,
          elapsedMs: 12,
        });
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/speak" &&
        options.listenOnly !== true
      ) {
        const parsed = speakRequestSchema.safeParse(jsonOrNull(body));
        if (!parsed.success) {
          sendError(response, 400, "invalid_request");
          return;
        }
        received.push({ kind: "speak", ...parsed.data });
        response.writeHead(200, {
          "content-type": "audio/wav",
          [SPEAK_ELAPSED_HEADER]: "8",
        });
        response.end(toneWav());
        return;
      }
      sendError(response, 404, "not_found");
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    stop: () => {
      server.close();
    },
  };
};
