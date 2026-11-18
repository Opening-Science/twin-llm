import { afterEach, describe, expect, test } from "bun:test";

import {
  type FakeSpeechSidecar,
  startFakeSpeechSidecar,
} from "@/infrastructure/speech/fake-speech-sidecar";
import { encodeWav, wavInfo } from "@/infrastructure/speech/wav";

import { pcmSamples, resample, roundTrip, toSidecarWav } from "./round-trip";

const running: FakeSpeechSidecar[] = [];
afterEach(() => {
  running.splice(0).forEach((sidecar) => sidecar.stop());
});

describe("voice:time helpers", () => {
  test("reads PCM back as it was written", () => {
    const samples = [...(pcmSamples(encodeWav(Float32Array.from([0, 0.5, -0.5]))) ?? [])];
    expect(samples.length).toBe(3);
    [0, 0.5, -0.5].forEach((value, index) =>
      expect(samples[index]).toBeCloseTo(value, 4),
    );
  });

  test("reads the data chunk where it is, not from the end of the file", () => {
    const plain = encodeWav(Float32Array.from([0.25, -0.25]));
    const list = new Uint8Array([
      ...new TextEncoder().encode("LIST"),
      4,
      0,
      0,
      0,
      9,
      9,
      9,
      9,
    ]);
    const samples = [...(pcmSamples(new Uint8Array([...plain, ...list])) ?? [])];
    expect(samples.length).toBe(2);
    [0.25, -0.25].forEach((value, index) => expect(samples[index]).toBeCloseTo(value, 4));
  });

  test("resamples 22,050 Hz to 16 kHz by length", () => {
    expect(resample(new Float32Array(22_050), 22_050, 16_000).length).toBe(16_000);
    expect([...resample(Float32Array.from([0, 1]), 1, 2)]).toEqual([0, 0.5, 1, 1]);
  });

  test("Piper's 22,050 Hz output becomes the sidecar's 16 kHz input", () => {
    const piper = encodeWav(new Float32Array(22_050), 22_050);
    expect(wavInfo(toSidecarWav(piper) ?? new Uint8Array())).toEqual({
      format: 1,
      channels: 1,
      sampleRate: 16_000,
      bitsPerSample: 16,
      dataBytes: 32_000,
      dataOffset: 44,
      durationMs: 1000,
    });
  });

  test("one round trip through the fake sidecar, timed", async () => {
    const sidecar = await startFakeSpeechSidecar();
    running.push(sidecar);
    let clock = 0;
    const result = await roundTrip(sidecar.baseUrl, "de", "Zeig mir mein Herz.", () => {
      clock += 100;
      return clock;
    });
    expect(result).toEqual({
      language: "de",
      sentence: "Zeig mir mein Herz.",
      heard: "Zeig mir mein Herz.",
      audioMs: 250,
      speakMs: 8,
      sttMs: 12,
      totalMs: 100,
    });
    expect(sidecar.received).toEqual([
      { kind: "speak", language: "de", text: "Zeig mir mein Herz." },
      { kind: "transcribe", language: "de", audioMs: 250 },
    ]);
  });

  test("refuses a sidecar that is not on this machine, before any request", async () => {
    await expect(roundTrip("http://192.0.2.1:8095", "en", "Hello.")).rejects.toThrow(
      "only talks to a sidecar on this machine",
    );
    await expect(
      roundTrip("http://127.0.0.1.example.com", "en", "Hello."),
    ).rejects.toThrow("only talks to a sidecar on this machine");
  });

  test("does not follow a redirect away from the sidecar", async () => {
    const elsewhere: string[] = [];
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        elsewhere.push(new URL(request.url).pathname);
        return new Response("no");
      },
    });
    const redirecting = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/collect`, 307),
    });
    try {
      await expect(
        roundTrip(`http://127.0.0.1:${redirecting.port}`, "en", "Hello."),
      ).rejects.toThrow();
      expect(elsewhere).toEqual([]);
    } finally {
      void redirecting.stop(true);
      void target.stop(true);
    }
  });
});
