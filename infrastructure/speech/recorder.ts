import { encodeWav, SPEECH_SAMPLE_RATE } from "./wav";

/**
 * The microphone, for push to talk. Records with the browser's own encoder
 * while the button is held, then decodes, mixes down to one channel and
 * resamples to 16 kHz with an offline audio graph, and writes the WAV the
 * speech sidecar takes (`wav.ts`). Browser only; nothing is kept once the
 * WAV is handed back, and the microphone is released when recording ends.
 */

export type Recording = Readonly<{
  /** Ends the recording and resolves with the WAV; null when nothing was recorded. */
  stop: () => Promise<Uint8Array | null>;
  /** Ends the recording and drops it. */
  cancel: () => void;
}>;

/** No microphone at all, or the person (or the browser) said no. */
export type MicrophoneProblem = "BLOCKED" | "MISSING";

/** Decoded audio of any rate and channel count to the sidecar's WAV. */
export const toSpeechWav = async (blob: Blob): Promise<Uint8Array | null> => {
  if (blob.size === 0) return null;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE);
    if (frames === 0) return null;
    const offline = new OfflineAudioContext(1, frames, SPEECH_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } catch {
    return null;
  } finally {
    void context.close();
  }
};

export const startRecording = async (): Promise<Recording | MicrophoneProblem> => {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    return "MISSING";
  }
  const stream = await navigator.mediaDevices
    .getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    .catch((error: unknown) =>
      error instanceof DOMException && error.name === "NotFoundError"
        ? ("MISSING" as const)
        : ("BLOCKED" as const),
    );
  if (typeof stream === "string") return stream;
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();
  return {
    stop: () =>
      new Promise<Uint8Array | null>((resolve) => {
        recorder.addEventListener(
          "stop",
          () => {
            release();
            void toSpeechWav(new Blob(chunks, { type: recorder.mimeType })).then(resolve);
          },
          { once: true },
        );
        if (recorder.state === "inactive") {
          release();
          resolve(null);
        } else recorder.stop();
      }),
    cancel: () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
};
