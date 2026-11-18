"use client";

import { type KeyboardEvent, useRef, useState } from "react";

import {
  SPEECH_FAILURE_MESSAGES,
  SPEECH_LANGUAGE_NAMES,
  type SpeechLanguage,
} from "@/infrastructure/speech/contract";
import {
  type MicrophoneProblem,
  type Recording,
  startRecording,
} from "@/infrastructure/speech/recorder";

import {
  MICROPHONE_LINES,
  pushToTalkLabel,
  type PushToTalkPhase,
  transcribeRecording,
  type VoiceHeard,
} from "./push-to-talk-model";

/**
 * Push to talk on the prompt bar (#616): hold the microphone button, or hold
 * Space or Enter on it, speak, let go. The recording goes to this app's
 * `/api/voice/transcribe` and on to the speech sidecar on this machine; the
 * text comes back and is sent like a typed prompt. Beside it the language the
 * sidecar listens and speaks in, English or German. Shown only when voice is
 * set up.
 */

const MicIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="size-4"
  >
    <rect x="7" y="2.5" width="6" height="10" rx="3" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
  </svg>
);

export const PushToTalk = ({
  language,
  disabled,
  onLanguage,
  onHeard,
  onListen,
}: Readonly<{
  language: SpeechLanguage;
  disabled: boolean;
  onLanguage: (next: SpeechLanguage) => void;
  onHeard: (heard: VoiceHeard) => void;
  /** Called as the microphone opens, so nothing the app is saying gets recorded. */
  onListen?: () => void;
}>) => {
  const [phase, setPhase] = useState<PushToTalkPhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const recording = useRef<Promise<Recording | MicrophoneProblem> | null>(null);

  const begin = () => {
    if (disabled || recording.current !== null || phase === "writing") return;
    onListen?.();
    setProblem(null);
    setPhase("listening");
    recording.current = startRecording();
  };

  const finish = async () => {
    const pending = recording.current;
    if (pending === null) return;
    recording.current = null;
    const started = await pending;
    if (typeof started === "string") {
      setPhase("idle");
      setProblem(MICROPHONE_LINES[started]);
      return;
    }
    const wav = await started.stop();
    if (wav === null) {
      setPhase("idle");
      setProblem(SPEECH_FAILURE_MESSAGES.SPEECH_NOTHING_HEARD);
      return;
    }
    setPhase("writing");
    const result = await transcribeRecording(wav, language);
    setPhase("idle");
    if (result.ok) onHeard(result.heard);
    else setProblem(result.message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) begin();
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    void finish();
  };

  const other: SpeechLanguage = language === "en" ? "de" : "en";
  const listening = phase === "listening";

  return (
    <span className="voice-control">
      <button
        type="button"
        className="voice-language"
        onClick={() => onLanguage(other)}
        disabled={disabled || phase !== "idle"}
        aria-label={`Voice language: ${SPEECH_LANGUAGE_NAMES[language]}. Switch to ${SPEECH_LANGUAGE_NAMES[other]}`}
      >
        {language.toUpperCase()}
      </button>
      <button
        type="button"
        className="voice-talk"
        data-listening={listening ? "" : undefined}
        aria-pressed={listening}
        aria-label={pushToTalkLabel(phase, language)}
        title={pushToTalkLabel(phase, language)}
        disabled={disabled || phase === "writing"}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          begin();
        }}
        onPointerUp={() => void finish()}
        onPointerCancel={() => void finish()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => void finish()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MicIcon />
      </button>
      <span role="status" className="voice-status">
        {phase === "idle" ? (problem ?? "") : pushToTalkLabel(phase, language)}
      </span>
    </span>
  );
};
