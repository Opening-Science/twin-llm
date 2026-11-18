import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  type FakeSpeechSidecar,
  startFakeSpeechSidecar,
} from "../../infrastructure/speech/fake-speech-sidecar";

import { DEFAULT_VOICE_HOME, probeVoice, voiceSection } from "./voice-probe";

const home = mkdtempSync(join(tmpdir(), "voice-probe-test-"));
const running: FakeSpeechSidecar[] = [];
afterAll(() => {
  running.forEach((sidecar) => sidecar.stop());
  rmSync(home, { recursive: true, force: true });
});

describe("voice in the doctor", () => {
  test("says nothing when voice was never asked for", async () => {
    const probe = await probeVoice({}, home);
    expect(probe).toEqual({ setUp: false, url: null, health: null });
    expect(voiceSection(probe)).toEqual([]);
  });

  test("set up and answering", async () => {
    mkdirSync(join(home, DEFAULT_VOICE_HOME), { recursive: true });
    writeFileSync(join(home, DEFAULT_VOICE_HOME, "voice.json"), "{}");
    const sidecar = await startFakeSpeechSidecar();
    running.push(sidecar);
    const probe = await probeVoice({ VOICE_SIDECAR_URL: sidecar.baseUrl }, home);
    expect(voiceSection(probe)).toEqual([
      "Voice (docs/voice.md)",
      "  [ok]      Engines set up (voice.json)",
      "  [ok]      Sidecar answers: fake fixed sentences; fake fake-en, fake-de",
      "",
    ]);
  });

  test("names what is missing", () => {
    expect(voiceSection({ setUp: true, url: null, health: null })[2]).toBe(
      "  [off]     VOICE_SIDECAR_URL not set: voice stays off in the app",
    );
    expect(
      voiceSection({ setUp: false, url: "http://127.0.0.1:8095", health: null }).slice(
        1,
        3,
      ),
    ).toEqual([
      "  [missing] Engines not set up: bun run voice:setup",
      "  [no]      The sidecar does not answer: bun run voice:serve",
    ]);
  });

  test("never calls an address off this machine", async () => {
    let called = 0;
    const probe = await probeVoice(
      { VOICE_SIDECAR_URL: "https://speech.example.org" },
      home,
      (() => {
        called += 1;
        return Promise.resolve(new Response("{}"));
      }) as unknown as typeof fetch,
    );
    expect(called).toBe(0);
    expect(voiceSection(probe)[2]).toBe(
      "  [no]      VOICE_SIDECAR_URL is not on this machine; the app will not start",
    );
  });

  test("VOICE_HOME moves the folder it looks in", async () => {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "voice.json"), "{}");
    expect((await probeVoice({ VOICE_HOME: elsewhere }, "/nowhere")).setUp).toBe(true);
  });
});
