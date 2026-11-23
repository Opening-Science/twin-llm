/**
 * The one audio shape the speech sidecar takes in: a RIFF WAV file of 16-bit
 * PCM, one channel, 16 kHz. The browser records in whatever its microphone
 * gives, resamples, and writes that shape with `encodeWav`; the server checks
 * a body with `speechWavProblem` before it goes anywhere. No I/O here, so the
 * same code runs in the browser, the route and the tests.
 */

export const SPEECH_SAMPLE_RATE = 16_000;

/** The longest question the sidecar takes: 60 seconds of speech. */
export const MAX_SPEECH_SECONDS = 60;

const HEADER_BYTES = 44;

export const MAX_SPEECH_WAV_BYTES =
  HEADER_BYTES + SPEECH_SAMPLE_RATE * 2 * MAX_SPEECH_SECONDS;

export type WavInfo = Readonly<{
  /** 1 is integer PCM; anything else is refused. */
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  /** Where the samples start: other chunks may come before or after `data`. */
  dataOffset: number;
  durationMs: number;
}>;

type WavFormat = Omit<WavInfo, "dataBytes" | "dataOffset" | "durationMs">;

const ascii = (view: DataView, offset: number, length: number): string =>
  String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );

/** Little-endian 16-bit mono PCM from samples in -1..1; values outside are clipped. */
export const encodeWav = (
  samples: Float32Array,
  sampleRate: number = SPEECH_SAMPLE_RATE,
): Uint8Array => {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      HEADER_BYTES + index * 2,
      Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff),
      true,
    );
  });
  return bytes;
};

/**
 * The header of a WAV file, found by walking its chunks to `fmt ` and `data`;
 * null when the bytes are not a RIFF WAVE file with both. A `data` size larger
 * than what follows is cut to what is there, as a recorder stopped early writes.
 */
export const wavInfo = (bytes: Uint8Array): WavInfo | null => {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") return null;
  const walk = (offset: number, fmt: WavFormat | null): WavInfo | null => {
    if (offset + 8 > bytes.length) return null;
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    const next = body + size + (size % 2);
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      return walk(next, {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      });
    }
    if (id !== "data") return walk(next, fmt);
    if (fmt === null) return null;
    const dataBytes = Math.min(size, bytes.length - body);
    const frameBytes = (fmt.bitsPerSample / 8) * fmt.channels;
    const durationMs =
      frameBytes > 0 && fmt.sampleRate > 0
        ? Math.round((dataBytes / frameBytes / fmt.sampleRate) * 1000)
        : 0;
    return { ...fmt, dataBytes, dataOffset: body, durationMs };
  };
  return walk(12, null);
};

export type SpeechWavProblem = "NOT_WAV" | "WRONG_SHAPE" | "EMPTY" | "TOO_LONG";

/** Why a body is not the sidecar's input shape, or null when it is. */
export const speechWavProblem = (bytes: Uint8Array): SpeechWavProblem | null => {
  if (bytes.length > MAX_SPEECH_WAV_BYTES) return "TOO_LONG";
  const info = wavInfo(bytes);
  if (info === null) return "NOT_WAV";
  if (
    info.format !== 1 ||
    info.channels !== 1 ||
    info.bitsPerSample !== 16 ||
    info.sampleRate !== SPEECH_SAMPLE_RATE
  ) {
    return "WRONG_SHAPE";
  }
  return info.dataBytes === 0 ? "EMPTY" : null;
};
