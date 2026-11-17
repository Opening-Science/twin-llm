import { afterEach, describe, expect, test } from "bun:test";

import {
  FAKE_SPEECH_HEALTH,
  type FakeSpeechSidecar,
  startFakeSpeechSidecar,
} from "./fake-speech-sidecar";
import { speakText, speechHealth, transcribeSpeech } from "./sidecar-client";
import { encodeWav, wavInfo } from "./wav";

const HALF_SECOND = encodeWav(new Float32Array(8000));

const running: FakeSpeechSidecar[] = [];
const start = async (
  options: Parameters<typeof startFakeSpeechSidecar>[0] = {},
): Promise<FakeSpeechSidecar> => {
  const sidecar = await startFakeSpeechSidecar(options);
  running.push(sidecar);
  return sidecar;
};

afterEach(() => {
  running.splice(0).forEach((sidecar) => sidecar.stop());
});

const configFor = (baseUrl: string | null, logged: string[] = [], timeoutMs = 2000) => ({
  baseUrl,
  timeoutMs,
  logError: (message: string) => logged.push(message),
});

describe("speech sidecar client", () => {
  test("reads the sidecar's health", async () => {
    const sidecar = await start();
    expect(await speechHealth(configFor(sidecar.baseUrl))).toEqual(FAKE_SPEECH_HEALTH);
  });

  test("no health when voice is off, elsewhere or down", async () => {
    expect(await speechHealth(configFor(null))).toBeNull();
    expect(await speechHealth(configFor("https://speech.example.org"))).toBeNull();
    expect(await speechHealth(configFor("http://127.0.0.1:1"))).toBeNull();
  });

  test("transcribes English and German", async () => {
    const sidecar = await start();
    expect(await transcribeSpeech(configFor(sidecar.baseUrl), HALF_SECOND, "en")).toEqual(
      {
        ok: true,
        text: "Show me my heart.",
        language: "en",
        audioMs: 500,
        elapsedMs: 12,
      },
    );
    expect(await transcribeSpeech(configFor(sidecar.baseUrl), HALF_SECOND, "de")).toEqual(
      {
        ok: true,
        text: "Zeig mir mein Herz.",
        language: "de",
        audioMs: 500,
        elapsedMs: 12,
      },
    );
    expect(sidecar.received).toEqual([
      { kind: "transcribe", language: "en", audioMs: 500 },
      { kind: "transcribe", language: "de", audioMs: 500 },
    ]);
  });

  test("refuses an address off this machine before sending anything", async () => {
    let called = 0;
    const config = {
      ...configFor("https://speech.example.org"),
      fetch: (() => {
        called += 1;
        return Promise.resolve(new Response("{}"));
      }) as unknown as typeof fetch,
    };
    expect(await transcribeSpeech(config, HALF_SECOND, "en")).toEqual({
      ok: false,
      code: "SPEECH_NOT_LOCAL",
    });
    expect(await speakText(config, { text: "Hello.", language: "en" })).toEqual({
      ok: false,
      code: "SPEECH_NOT_LOCAL",
    });
    expect(called).toBe(0);
  });

  test("voice off is its own code", async () => {
    expect(await transcribeSpeech(configFor(null), HALF_SECOND, "en")).toEqual({
      ok: false,
      code: "SPEECH_OFF",
    });
  });

  test("a body that is not the contract's WAV is never sent", async () => {
    const sidecar = await start();
    expect(
      await transcribeSpeech(
        configFor(sidecar.baseUrl),
        encodeWav(new Float32Array(800), 48_000),
        "en",
      ),
    ).toEqual({ ok: false, code: "SPEECH_BAD_AUDIO" });
    expect(sidecar.received).toEqual([]);
  });

  test("an empty transcript means nothing was heard", async () => {
    const sidecar = await start({ transcripts: { en: "  " } });
    expect(await transcribeSpeech(configFor(sidecar.baseUrl), HALF_SECOND, "en")).toEqual(
      {
        ok: false,
        code: "SPEECH_NOTHING_HEARD",
      },
    );
  });

  test("the sidecar's error text goes to the log, never to the caller", async () => {
    const sidecar = await start({ status: 500 });
    const logged: string[] = [];
    const result = await transcribeSpeech(
      configFor(sidecar.baseUrl, logged),
      HALF_SECOND,
      "en",
    );
    expect(result).toEqual({ ok: false, code: "SPEECH_FAILED" });
    expect(logged).toEqual([
      "speech sidecar transcribe: HTTP 500 fake sidecar: model file missing at /models/x.bin",
    ]);
  });

  test("down and slow are told apart", async () => {
    expect(
      await transcribeSpeech(configFor("http://127.0.0.1:1"), HALF_SECOND, "en"),
    ).toEqual({ ok: false, code: "SPEECH_UNREACHABLE" });
    const slow = await start({ delayMs: 300 });
    expect(
      await transcribeSpeech(configFor(slow.baseUrl, [], 50), HALF_SECOND, "en"),
    ).toEqual({ ok: false, code: "SPEECH_TIMEOUT" });
  });

  test("speaks a WAV back with the sidecar's time", async () => {
    const sidecar = await start();
    const result = await speakText(configFor(sidecar.baseUrl), {
      text: "Dein Herz schlägt ruhig.",
      language: "de",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.elapsedMs).toBe(8);
    expect(wavInfo(result.wav)?.durationMs).toBe(250);
    expect(sidecar.received).toEqual([
      { kind: "speak", language: "de", text: "Dein Herz schlägt ruhig." },
    ]);
  });
});
