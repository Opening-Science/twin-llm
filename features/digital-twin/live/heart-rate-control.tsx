"use client";

import { useId } from "react";

export const HEART_RATE_MIN = 25;
export const HEART_RATE_MAX = 230;
export const ILLUSTRATIVE_HEART_RATE = 70;

export type HeartRateControlModel = Readonly<{
  bpm: number | null;
  overridden: boolean;
  nightPlayback: boolean;
  onChange: (bpm: number) => void;
  onReset: () => void;
}>;

/** The animation rate is separate from the recorded vitals, which are never mutated. */
export const heartAnimationRate = (
  recorded: number | null,
  override: number | null,
  nightPlayback: boolean,
): Readonly<{ bpm: number | null; illustrative: boolean }> => {
  if (nightPlayback) return { bpm: recorded, illustrative: false };
  if (override !== null) return { bpm: override, illustrative: true };
  return recorded === null
    ? { bpm: ILLUSTRATIVE_HEART_RATE, illustrative: true }
    : { bpm: recorded, illustrative: false };
};

export const HeartRateControl = ({
  control,
  onInteract,
}: Readonly<{ control: HeartRateControlModel; onInteract?: () => void }>) => {
  const id = useId();
  const noteId = useId();
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <label htmlFor={id}>Heart rate</label>
        <span>{control.bpm === null ? "No reading" : `${control.bpm} bpm`}</span>
      </div>
      <input
        id={id}
        type="range"
        min={HEART_RATE_MIN}
        max={HEART_RATE_MAX}
        step={1}
        value={Math.round(control.bpm ?? ILLUSTRATIVE_HEART_RATE)}
        aria-valuetext={
          control.bpm === null
            ? "No heart rate reading"
            : `${control.bpm} beats per minute`
        }
        aria-describedby={noteId}
        disabled={control.nightPlayback}
        onChange={(event) => {
          control.onChange(Number(event.target.value));
          onInteract?.();
        }}
        className="mt-1 w-full accent-[var(--primary)] disabled:opacity-50"
      />
      <p id={noteId} className="text-muted-foreground text-xs">
        {control.nightPlayback
          ? "Night playback controls the animation rate while open."
          : "Adjusts the illustrative animation only; recorded readings are unchanged."}
      </p>
      {control.overridden && !control.nightPlayback ? (
        <button
          type="button"
          className="mt-1 text-xs underline"
          onClick={control.onReset}
        >
          Use recorded or default rate
        </button>
      ) : null}
    </div>
  );
};
