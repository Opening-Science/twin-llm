import { describe, expect, test } from "bun:test";

import { encodeWav, MAX_SPEECH_WAV_BYTES, speechWavProblem, wavInfo } from "./wav";

const withFormat = (bytes: Uint8Array, edit: (view: DataView) => void): Uint8Array => {
  const copy = bytes.slice();
  edit(new DataView(copy.buffer));
  return copy;
};

describe("encodeWav", () => {
  test("writes a 16 kHz mono 16-bit header and clipped samples", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2, -0.5]));
    expect(wav.length).toBe(44 + 10);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    const view = new DataView(wav.buffer);
    expect(
      [0, 1, -1, 2, -0.5].map((_, index) => view.getInt16(44 + index * 2, true)),
    ).toEqual([0, 32767, -32768, 32767, -16384]);
    expect(wavInfo(wav)).toEqual({
      format: 1,
      channels: 1,
      sampleRate: 16_000,
      bitsPerSample: 16,
      dataBytes: 10,
      durationMs: 0,
    });
  });

  test("a second of samples lasts 1000 ms", () => {
    expect(wavInfo(encodeWav(new Float32Array(16_000)))?.durationMs).toBe(1000);
  });
});

describe("wavInfo", () => {
  test("skips a chunk before data, as some recorders write", () => {
    const plain = encodeWav(new Float32Array(160));
    const list = new Uint8Array([
      ...new TextEncoder().encode("LIST"),
      3,
      0,
      0,
      0,
      1,
      2,
      3,
      0,
    ]);
    const withList = new Uint8Array([...plain.slice(0, 36), ...list, ...plain.slice(36)]);
    expect(wavInfo(withList)?.dataBytes).toBe(320);
  });

  test("cuts a data size larger than the file to what is there", () => {
    const short = encodeWav(new Float32Array(160)).slice(0, 44 + 100);
    expect(wavInfo(short)?.dataBytes).toBe(100);
  });

  test("null for anything that is not RIFF WAVE", () => {
    expect(wavInfo(new Uint8Array(10))).toBeNull();
    expect(wavInfo(new TextEncoder().encode("x".repeat(64)))).toBeNull();
  });
});

describe("speechWavProblem", () => {
  const ok = encodeWav(new Float32Array(1600));

  test("accepts the sidecar's shape", () => {
    expect(speechWavProblem(ok)).toBeNull();
  });

  test("names what is wrong", () => {
    expect(speechWavProblem(new Uint8Array(100))).toBe("NOT_WAV");
    expect(speechWavProblem(encodeWav(new Float32Array(0)))).toBe("EMPTY");
    expect(speechWavProblem(encodeWav(new Float32Array(160), 44_100))).toBe(
      "WRONG_SHAPE",
    );
    expect(speechWavProblem(withFormat(ok, (view) => view.setUint16(22, 2, true)))).toBe(
      "WRONG_SHAPE",
    );
    expect(speechWavProblem(withFormat(ok, (view) => view.setUint16(20, 3, true)))).toBe(
      "WRONG_SHAPE",
    );
    expect(speechWavProblem(new Uint8Array(MAX_SPEECH_WAV_BYTES + 1))).toBe("TOO_LONG");
  });
});
