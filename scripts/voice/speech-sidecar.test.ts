import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import type { SpeechLanguage } from "@/infrastructure/speech/contract";
import { encodeWav, wavInfo } from "@/infrastructure/speech/wav";

import {
  cleanTranscript,
  createSpeechSidecar,
  type SpeechEngines,
} from "./speech-sidecar";

const workDir = mkdtempSync(join(tmpdir(), "voice-sidecar-test-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const HEALTH = {
  status: "ok",
  stt: { engine: "whisper.cpp", model: "ggml-small-q5_1.bin" },
  tts: {
    engine: "piper",
    voices: { en: "en_GB-alba-medium", de: "de_DE-thorsten-medium" },
  },
} as const;

type Seen = { transcribe: [string, SpeechLanguage][]; speak: [string, SpeechLanguage][] };

const fakeEngines = (
  seen: Seen,
  heard = " Show me my heart. [BLANK_AUDIO]",
  fail = false,
  listenOnly = false,
): SpeechEngines => ({
  health: listenOnly ? { ...HEALTH, tts: null } : HEALTH,
  transcribe: (path, language) => {
    seen.transcribe.push([path, language]);
    if (fail) return Promise.reject(new Error("whisper-cli exited with 1: no model"));
    return Promise.resolve(heard);
  },
  speak: listenOnly
    ? null
    : async (text, language, outPath) => {
        seen.speak.push([text, language]);
        if (fail) throw new Error("piper exited with 1: voice missing");
        await writeFile(outPath, encodeWav(new Float32Array(1600)));
      },
});

const setup = (
  options: Readonly<{ heard?: string; fail?: boolean; listenOnly?: boolean }> = {},
) => {
  const seen: Seen = { transcribe: [], speak: [] };
  const logged: string[] = [];
  let clock = 0;
  const handle = createSpeechSidecar({
    engines: fakeEngines(seen, options.heard, options.fail, options.listenOnly),
    workDir,
    now: () => {
      clock += 250;
      return clock;
    },
    log: (line) => logged.push(line),
  });
  return { handle, seen, logged };
};

const transcribeRequest = (body: Uint8Array, language = "en") =>
  new Request(`http://127.0.0.1:8095/v1/transcribe?language=${language}`, {
    method: "POST",
    body: body.slice(),
  });

const speakRequest = (body: unknown) =>
  new Request("http://127.0.0.1:8095/v1/speak", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("cleanTranscript", () => {
  test("drops whisper's marks for silence and noise", () => {
    expect(cleanTranscript(" [BLANK_AUDIO]\n")).toBe("");
    expect(cleanTranscript(" Zeig mir mein Herz. (Musik)\n [Applaus]")).toBe(
      "Zeig mir mein Herz.",
    );
  });
});

describe("speech sidecar", () => {
  test("answers its health", async () => {
    const { handle } = setup();
    const response = await handle(new Request("http://127.0.0.1:8095/health"));
    expect(await response.json()).toEqual(HEALTH);
  });

  test("transcribes, times it, and keeps no file", async () => {
    const { handle, seen, logged } = setup();
    const response = await handle(
      transcribeRequest(encodeWav(new Float32Array(8000)), "de"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "Show me my heart.",
      language: "de",
      audioMs: 500,
      elapsedMs: 250,
    });
    expect(seen.transcribe.map(([, language]) => language)).toEqual(["de"]);
    expect(readdirSync(workDir)).toEqual([]);
    expect(logged).toEqual(["transcribe de audio=500ms elapsed=250ms"]);
  });

  test("refuses a language or audio outside the contract before any engine runs", async () => {
    const { handle, seen } = setup();
    const french = await handle(
      transcribeRequest(encodeWav(new Float32Array(800)), "fr"),
    );
    expect(french.status).toBe(400);
    expect(await french.json()).toEqual({
      error: { message: "The language must be en or de.", type: "invalid_request" },
    });
    const stereo = await handle(
      transcribeRequest(encodeWav(new Float32Array(800), 44_100)),
    );
    expect(stereo.status).toBe(400);
    expect(seen.transcribe).toEqual([]);
  });

  test("an engine's failure is logged; the caller gets a plain sentence", async () => {
    const { handle, logged } = setup({ fail: true });
    const response = await handle(transcribeRequest(encodeWav(new Float32Array(800))));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { message: "Speech to text failed.", type: "engine_error" },
    });
    expect(logged).toEqual(["transcribe en failed: whisper-cli exited with 1: no model"]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  test("speaks a WAV with the time in a header, and logs no text", async () => {
    const { handle, seen, logged } = setup();
    const response = await handle(
      speakRequest({ text: "Your heart is fine.", language: "en" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-speech-elapsed-ms")).toBe("250");
    expect(wavInfo(new Uint8Array(await response.arrayBuffer()))?.durationMs).toBe(100);
    expect(seen.speak).toEqual([["Your heart is fine.", "en"]]);
    expect(logged).toEqual(["speak en chars=19 elapsed=250ms"]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  test("refuses empty, too long or unknown-language text", async () => {
    const { handle, seen } = setup();
    const statuses = await Promise.all(
      [
        { text: " ", language: "en" },
        { text: "a".repeat(2001), language: "en" },
        { text: "Bonjour", language: "fr" },
        "not an object",
      ].map(async (body) => (await handle(speakRequest(body))).status),
    );
    expect(statuses).toEqual([400, 400, 400, 400]);
    expect(seen.speak).toEqual([]);
  });

  test("without a local voice it does not speak, and says the browser reads aloud", async () => {
    const { handle, logged } = setup({ listenOnly: true });
    const health = await handle(new Request("http://127.0.0.1:8095/health"));
    expect(await health.json()).toEqual({ ...HEALTH, tts: null });
    const response = await handle(
      speakRequest({ text: "Your heart is fine.", language: "en" }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        message: "This sidecar has no voice; answers are read aloud in the browser.",
        type: "no_voice",
      },
    });
    expect(logged).toEqual([]);
  });

  test("anything else is not found", async () => {
    const { handle } = setup();
    expect((await handle(new Request("http://127.0.0.1:8095/v1/models"))).status).toBe(
      404,
    );
  });
});
