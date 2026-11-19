import {
  SPEAK_ELAPSED_HEADER,
  type SpeechLanguage,
  transcriptSchema,
} from "@/infrastructure/speech/contract";
import { encodeWav, SPEECH_SAMPLE_RATE, wavInfo } from "@/infrastructure/speech/wav";

/**
 * One timed round trip through the speech sidecar (#615), for `voice:time`
 * (`time.ts`): the sidecar speaks a fixed sentence, the spoken WAV is turned
 * into the 16 kHz shape, and the sidecar writes it down again. No microphone
 * is needed and no recording is kept. It needs a sidecar with a local voice a
 * person set up themselves; by default the sidecar only listens.
 */

export const NO_LOCAL_VOICE =
  "voice:time needs a sidecar with a local voice of your own (docs/voice.md); this one only listens";

export const ROUND_TRIP_SENTENCES: Readonly<Record<SpeechLanguage, readonly string[]>> = {
  en: ["Show me my heart.", "How was my blood sugar after breakfast?"],
  de: ["Zeig mir mein Herz.", "Wie war mein Blutzucker nach dem Frühstück?"],
};

/** 16-bit PCM samples of one channel (the first) as -1..1. */
export const pcmSamples = (bytes: Uint8Array): Float32Array | null => {
  const info = wavInfo(bytes);
  if (info === null || info.format !== 1 || info.bitsPerSample !== 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(info.dataBytes / (2 * info.channels));
  return Float32Array.from({ length: frames }, (_, frame) => {
    const value = view.getInt16(info.dataOffset + frame * 2 * info.channels, true);
    return value < 0 ? value / 0x8000 : value / 0x7fff;
  });
};

/** Linear resampling; enough for speech going to a speech model. */
export const resample = (
  samples: Float32Array,
  from: number,
  to: number,
): Float32Array => {
  if (from === to) return samples;
  const length = Math.floor((samples.length * to) / from);
  return Float32Array.from({ length }, (_, index) => {
    const at = (index * from) / to;
    const left = Math.floor(at);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = at - left;
    return (samples[left] ?? 0) * (1 - weight) + (samples[right] ?? 0) * weight;
  });
};

/** A spoken WAV of any rate in the sidecar's input shape. */
export const toSidecarWav = (bytes: Uint8Array): Uint8Array | null => {
  const info = wavInfo(bytes);
  const samples = pcmSamples(bytes);
  if (info === null || samples === null) return null;
  return encodeWav(resample(samples, info.sampleRate, SPEECH_SAMPLE_RATE));
};

/** The sidecar this measures must run on this machine. */
export const isLocalSidecarUrl = (url: string): boolean =>
  /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url);

export type RoundTrip = Readonly<{
  language: SpeechLanguage;
  sentence: string;
  heard: string;
  audioMs: number;
  speakMs: number;
  sttMs: number;
  totalMs: number;
}>;

export const roundTrip = async (
  baseUrl: string,
  language: SpeechLanguage,
  sentence: string,
  now: () => number = () => performance.now(),
): Promise<RoundTrip> => {
  if (!isLocalSidecarUrl(baseUrl)) {
    throw new Error("voice:time only talks to a sidecar on this machine");
  }
  const started = now();
  const spoken = await fetch(`${baseUrl}/v1/speak`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: sentence, language }),
  });
  if (spoken.status === 404) throw new Error(NO_LOCAL_VOICE);
  if (!spoken.ok) throw new Error(`speak answered ${spoken.status}`);
  const speakMs = Number(spoken.headers.get(SPEAK_ELAPSED_HEADER) ?? "0");
  const wav = toSidecarWav(new Uint8Array(await spoken.arrayBuffer()));
  if (wav === null) throw new Error("speak did not answer with 16-bit PCM WAV");
  const heard = await fetch(`${baseUrl}/v1/transcribe?language=${language}`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "audio/wav" },
    body: new Blob([wav.slice()], { type: "audio/wav" }),
  });
  if (!heard.ok) throw new Error(`transcribe answered ${heard.status}`);
  const transcript = transcriptSchema.parse(await heard.json());
  return {
    language,
    sentence,
    heard: transcript.text,
    audioMs: transcript.audioMs,
    speakMs,
    sttMs: transcript.elapsedMs,
    totalMs: Math.round(now() - started),
  };
};
