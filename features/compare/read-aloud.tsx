"use client";

import { useVoice } from "./voice-context";

/**
 * "Read aloud" under a finished answer (#616), when voice is set up. It reads
 * the answer in the voice language picked on the prompt bar; pressed again,
 * or while another answer is being read, it stops. The text it reads is the
 * answer's own words (`infrastructure/speech/spoken-text.ts`).
 */

export const READ_ALOUD = "Read aloud";
export const STOP_READING = "Stop reading";

const SpeakerIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="size-3.5"
  >
    <path d="M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a6.5 6.5 0 0 1 0 10" />
  </svg>
);

export const ReadAloud = ({ id, text }: Readonly<{ id: string; text: string }>) => {
  const voice = useVoice();
  if (!voice.on) return null;
  const reading = voice.player.speakingId === id;
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="read-aloud"
        aria-pressed={reading}
        onClick={() =>
          reading ? voice.player.stop() : voice.player.speak(id, text, voice.language)
        }
      >
        <SpeakerIcon />
        {reading ? STOP_READING : READ_ALOUD}
      </button>
      {voice.player.problem?.id === id && !reading ? (
        <span role="status" className="text-muted-foreground text-xs">
          {voice.player.problem.message}
        </span>
      ) : null}
    </span>
  );
};
