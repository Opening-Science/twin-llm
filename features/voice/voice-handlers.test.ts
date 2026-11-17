import { afterEach, describe, expect, test } from "bun:test";

import {
  type FakeSpeechSidecar,
  startFakeSpeechSidecar,
} from "@/infrastructure/speech/fake-speech-sidecar";
import { encodeWav, wavInfo } from "@/infrastructure/speech/wav";

import { createVoiceHandlers } from "./voice-handlers";

const running: FakeSpeechSidecar[] = [];
afterEach(() => {
  running.splice(0).forEach((sidecar) => sidecar.stop());
});

const signedIn = () => Promise.resolve("user_synthetic_1");
const signedOut = () => Promise.resolve(null);

const handlersFor = async (
  options: Readonly<{
    baseUrl?: string | null;
    actor?: () => Promise<string | null>;
    fake?: Parameters<typeof startFakeSpeechSidecar>[0];
  }> = {},
) => {
  const sidecar = await startFakeSpeechSidecar(options.fake);
  running.push(sidecar);
  const logged: string[] = [];
  let clock = 1000;
  const handlers = createVoiceHandlers({
    resolveActorId: options.actor ?? signedIn,
    config: () => ({
      baseUrl: options.baseUrl === undefined ? sidecar.baseUrl : options.baseUrl,
      timeoutMs: 2000,
      logError: (line) => logged.push(line),
    }),
    now: () => {
      clock += 40;
      return clock;
    },
  });
  return { handlers, sidecar, logged };
};

const recording = (
  language: string,
  body: Uint8Array = encodeWav(new Float32Array(16_000)),
) =>
  new Request(`http://localhost/api/voice/transcribe?language=${language}`, {
    method: "POST",
    body: body.slice(),
  });

describe("voice routes", () => {
  test("status says on with both languages when the sidecar answers", async () => {
    const { handlers } = await handlersFor();
    const response = await handlers.status();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ on: true, languages: ["en", "de"] });
  });

  test("status says off when voice is not set up", async () => {
    const { handlers } = await handlersFor({ baseUrl: null });
    expect(await (await handlers.status()).json()).toEqual({ on: false, languages: [] });
  });

  test("a recording comes back as text with its timings", async () => {
    const { handlers, sidecar } = await handlersFor();
    const response = await handlers.transcribe(recording("de"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "Zeig mir mein Herz.",
      language: "de",
      timings: { audioMs: 1000, sttMs: 12, totalMs: 40 },
    });
    expect(sidecar.received).toEqual([
      { kind: "transcribe", language: "de", audioMs: 1000 },
    ]);
  });

  test("signed out gets nothing and sends nothing", async () => {
    const { handlers, sidecar } = await handlersFor({ actor: signedOut });
    expect((await handlers.status()).status).toBe(401);
    expect((await handlers.transcribe(recording("en"))).status).toBe(401);
    expect(
      (
        await handlers.speak(
          new Request("http://localhost/api/voice/speak", {
            method: "POST",
            body: JSON.stringify({ text: "Hi.", language: "en" }),
          }),
        )
      ).status,
    ).toBe(401);
    expect(sidecar.received).toEqual([]);
  });

  test("a language outside English and German is refused before the sidecar", async () => {
    const { handlers, sidecar } = await handlersFor();
    const response = await handlers.transcribe(recording("fr"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "SPEECH_BAD_AUDIO",
      error: "That recording could not be read. Try again.",
    });
    expect(sidecar.received).toEqual([]);
  });

  test("the sidecar's failure is a plain sentence; its text stays in the log", async () => {
    const { handlers, logged } = await handlersFor({ fake: { status: 500 } });
    const response = await handlers.transcribe(recording("en"));
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toBe(
      JSON.stringify({
        code: "SPEECH_FAILED",
        error: "The voice service could not handle that. Try again.",
      }),
    );
    expect(logged).toEqual([
      "speech sidecar transcribe: HTTP 500 fake sidecar: model file missing at /models/x.bin",
    ]);
  });

  test("silence is told apart from a failure", async () => {
    const { handlers } = await handlersFor({ fake: { transcripts: { en: "" } } });
    const response = await handlers.transcribe(recording("en"));
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe(
      "SPEECH_NOTHING_HEARD",
    );
  });

  test("speak returns the sidecar's WAV and its time", async () => {
    const { handlers, sidecar } = await handlersFor();
    const response = await handlers.speak(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: JSON.stringify({ text: "Your heart rate was steady.", language: "en" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-speech-elapsed-ms")).toBe("8");
    expect(wavInfo(new Uint8Array(await response.arrayBuffer()))?.durationMs).toBe(250);
    expect(sidecar.received).toEqual([
      { kind: "speak", language: "en", text: "Your heart rate was steady." },
    ]);
  });

  test("speak refuses empty text", async () => {
    const { handlers, sidecar } = await handlersFor();
    const response = await handlers.speak(
      new Request("http://localhost/api/voice/speak", {
        method: "POST",
        body: JSON.stringify({ text: "  ", language: "en" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(sidecar.received).toEqual([]);
  });
});
