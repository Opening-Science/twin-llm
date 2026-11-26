"use client";

import { useId } from "react";

import { GLUCOSE_EFFECT } from "@/packages/anatomy/effects";

import { type GlucoseStatus } from "./glucose-flow";

/**
 * Not fetched here is a setup step, so it reads as a plain state, not an
 * error. Like the atlas, the page names no command; the API answer and
 * docs/anatomy.md name `bun run anatomy:fetch`.
 */
export const GLUCOSE_NOT_INSTALLED = "Vessel particles are not installed here.";

export type GlucoseControlModel = Readonly<{
  density: number;
  status: GlucoseStatus;
  unavailable: string | null;
  onDensity: (density: number) => void;
  onRetry: () => void;
}>;

export const GlucoseControl = ({
  control,
  onInteract,
}: Readonly<{ control: GlucoseControlModel; onInteract?: () => void }>) => {
  const id = useId();
  const noteId = useId();
  const count = Math.round(control.density * GLUCOSE_EFFECT.maxParticles);
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <label htmlFor={id}>Vessel particles</label>
        <span>
          {count} / {GLUCOSE_EFFECT.maxParticles}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={control.density}
        aria-valuetext={`${count} of ${GLUCOSE_EFFECT.maxParticles} particles`}
        aria-describedby={noteId}
        disabled={control.unavailable !== null || control.status === "missing"}
        onChange={(event) => {
          control.onDensity(Number(event.target.value));
          onInteract?.();
        }}
        className="mt-1 w-full accent-[var(--primary)] disabled:opacity-50"
      />
      <p id={noteId} className="text-muted-foreground text-xs">
        {control.unavailable ?? "Shown at Organs depth with Cardiovascular enabled."}{" "}
        Illustrative particles, not measured glucose particles or blood velocity.
      </p>
      {control.unavailable === null && control.status === "loading" ? (
        <p role="status" className="text-muted-foreground mt-1 text-xs">
          Loading particles...
        </p>
      ) : null}
      {control.unavailable === null && control.status === "missing" ? (
        <p role="status" className="text-muted-foreground mt-1 text-xs">
          {GLUCOSE_NOT_INSTALLED}
        </p>
      ) : null}
      {control.unavailable === null && control.status === "error" ? (
        <p role="alert" className="mt-1 text-xs">
          Could not load the particles.{" "}
          <button type="button" className="underline" onClick={control.onRetry}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
};
