import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  type LocalPiper,
  localPiper,
  type Run,
  speechEngines,
  type VoiceSetup,
} from "./engines";

/**
 * The engines against stand-in programs: shell scripts that answer the way
 * whisper-cli and piper do, so no build or model is needed. Piper is never
 * part of the setup; it is only used when a person names their own.
 */

const dir = mkdtempSync(join(tmpdir(), "voice-engines-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const script = (name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

// Writes "<-of>.txt" with the language it was given, as whisper-cli -otxt does.
const whisper = script(
  "whisper-cli",
  `while [ $# -gt 0 ]; do
  case "$1" in --language) lang="$2"; shift 2;; --output-file) out="$2"; shift 2;; *) shift;; esac
done
printf ' heard in %s\\n' "$lang" > "$out.txt"`,
);
// Writes the text it read on stdin to the -f file, and its arguments to
// "<-f>.argv", so the test can read both back.
const piper = script(
  "piper",
  `args="$*"
while [ $# -gt 0 ]; do
  case "$1" in -f) out="$2"; shift 2;; *) shift;; esac
done
cat > "$out"
printf '%s' "$args" > "$out.argv"`,
);
const broken = script("broken", `echo "model file missing" >&2; exit 3`);

const SETUP: VoiceSetup = {
  whisper: { bin: whisper, model: "/models/ggml-small-q5_1.bin", threads: 4 },
};

const PIPER: LocalPiper = {
  bin: piper,
  voices: {
    en: "/voices/en_GB-alba-medium.onnx",
    de: "/voices/de_DE-thorsten-medium.onnx",
  },
};

describe("localPiper", () => {
  test("off unless a person names their own Piper", () => {
    expect(localPiper({})).toEqual({ ok: true, piper: null });
    expect(localPiper({ VOICE_PIPER_BIN: " " })).toEqual({ ok: true, piper: null });
  });

  test("on with the program and both voices", () => {
    expect(
      localPiper({
        VOICE_PIPER_BIN: "piper",
        VOICE_PIPER_EN: "/v/en.onnx",
        VOICE_PIPER_DE: "/v/de.onnx",
      }),
    ).toEqual({
      ok: true,
      piper: { bin: "piper", voices: { en: "/v/en.onnx", de: "/v/de.onnx" } },
    });
  });

  test("half a Piper names what is missing", () => {
    expect(
      localPiper({ VOICE_PIPER_BIN: "piper", VOICE_PIPER_EN: "/v/en.onnx" }),
    ).toEqual({ ok: false, missing: ["VOICE_PIPER_DE"] });
  });
});

describe("speech engines", () => {
  test("by default it only listens: no voice in its health and nothing to speak with", () => {
    const engines = speechEngines(SETUP, null);
    expect(engines.health).toEqual({
      status: "ok",
      stt: { engine: "whisper.cpp", model: "ggml-small-q5_1.bin" },
      tts: null,
    });
    expect(engines.speak).toBeNull();
  });

  test("health names the model and voices, not their folders", () => {
    expect(speechEngines(SETUP, PIPER).health).toEqual({
      status: "ok",
      stt: { engine: "whisper.cpp", model: "ggml-small-q5_1.bin" },
      tts: {
        engine: "piper",
        voices: { en: "en_GB-alba-medium", de: "de_DE-thorsten-medium" },
      },
    });
  });

  test("runs whisper-cli with the language and reads its text file", async () => {
    expect(
      await speechEngines(SETUP, null).transcribe(join(dir, "question.wav"), "de"),
    ).toBe(" heard in de\n");
  });

  test("passes whisper-cli the model, threads and plain-text output", async () => {
    const calls: (readonly string[])[] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      writeFileSync(join(dir, "q.txt"), "x");
      return Promise.resolve({ code: 0, stderr: "" });
    };
    await speechEngines(SETUP, null, run).transcribe(join(dir, "q.wav"), "en");
    expect(calls).toEqual([
      [
        "--model",
        "/models/ggml-small-q5_1.bin",
        "--file",
        join(dir, "q.wav"),
        "--language",
        "en",
        "--threads",
        "4",
        "--no-timestamps",
        "--no-prints",
        "--output-txt",
        "--output-file",
        join(dir, "q"),
      ],
    ]);
  });

  test("gives Piper the text on stdin, quotes and all, as one line", async () => {
    const out = join(dir, "answer.wav");
    const text = `Dein Herz: "ruhig";\n$(echo nein) & gut.`;
    await speechEngines(SETUP, PIPER).speak?.(text, "de", out);
    expect(readFileSync(out, "utf8")).toBe(`Dein Herz: "ruhig"; $(echo nein) & gut.\n`);
  });

  test("keeps the text out of Piper's arguments, where any user could read it", async () => {
    const out = join(dir, "private.wav");
    await speechEngines(SETUP, PIPER).speak?.(
      "Your resting heart rate was 52.",
      "en",
      out,
    );
    const argv = readFileSync(`${out}.argv`, "utf8");
    expect(argv).toBe(`-m /voices/en_GB-alba-medium.onnx -f ${out}`);
    expect(argv).not.toContain("heart");
  });

  test("a failed engine throws with its exit code and error text", async () => {
    const setup = { ...SETUP, whisper: { ...SETUP.whisper, bin: broken } };
    await expect(
      speechEngines(setup, null).transcribe(join(dir, "q.wav"), "en"),
    ).rejects.toThrow("broken exited with 3: model file missing");
  });

  test("picks the voice for the language", async () => {
    const calls: (readonly unknown[])[] = [];
    const run: Run = (_command, args, input) => {
      calls.push([args, input]);
      return Promise.resolve({ code: 0, stderr: "" });
    };
    await speechEngines(SETUP, PIPER, run).speak?.("Hello.", "en", "/work/a.wav");
    expect(calls).toEqual([
      [["-m", "/voices/en_GB-alba-medium.onnx", "-f", "/work/a.wav"], "Hello.\n"],
    ]);
  });
});
