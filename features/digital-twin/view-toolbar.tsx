import { type Ref } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

import { ENTER_ENVIRONMENT, EXIT_ENVIRONMENT } from "./environment/environment-copy";
import { LIVE_TOGGLE } from "./live/live-copy";
import { DANCE_TEMPOS } from "./motion/dance";
import { MOTION_LABEL, TEMPO_LABEL, tempoOption } from "./motion/motion-copy";
import { type MotionControl } from "./motion/use-body-motion";

/**
 * The 3D view controls, directly above the canvas, in three groups: View
 * (Reset, Pause, zoom), Show (Landmarks, Live vitals, the motion clips) and Enter/Exit. A row
 * that runs out of room wraps between groups, never inside one.
 *
 * It renders only with a canvas: Reset or Pause with no view to act on did
 * nothing. Pause/Rotate names the action it will take, so it carries no
 * `aria-pressed`; Landmarks keeps one label and reports its state with
 * `aria-pressed` instead. Zoom is two glyphs with spoken names. Enter/Exit
 * environment names its action like Pause does, and stays in the row inside
 * the environment as the exit. Walk, Run, Idle, Dance loop and, when a clip
 * made from a video is installed, Dance (video) are one choice of at most one
 * clip; pressing the playing one stops it. While the dance loop plays a small
 * Tempo select follows it. Without a rig or with reduced motion the clips
 * stay in place, disabled, and the reason is the button title and a line
 * beside the view.
 */

/** The same pressed look as `.chip[aria-pressed="true"]` in the anatomy controls. */
const PRESSED =
  "aria-pressed:border-primary aria-pressed:text-foreground aria-pressed:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]";

export type ViewToolbarProps = Readonly<{
  autoRotate: boolean;
  onReset: () => void;
  onToggleRotate: () => void;
  onZoom: (direction: "in" | "out") => void;
  /** Scans only; the demo body has no landmarks. */
  landmarks?: Readonly<{ shown: boolean; onToggle: () => void }>;
  /** Live vitals (G4); only when the subject has a rate and motion is allowed. */
  liveVitals?: Readonly<{ on: boolean; onToggle: () => void }>;
  /** Whole-body motion (#51), once a body has loaded. */
  motion?: MotionControl;
  /** The full-screen environment; focus returns to this button on exit. */
  environment?: Readonly<{ active: boolean; onToggle: () => void }>;
  environmentRef?: Ref<HTMLButtonElement>;
}>;

export const ViewToolbar = ({
  autoRotate,
  onReset,
  onToggleRotate,
  onZoom,
  landmarks,
  liveVitals,
  motion,
  environment,
  environmentRef,
}: ViewToolbarProps) => (
  <div
    role="group"
    aria-label="3D view"
    className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5"
  >
    <div role="group" aria-label="View" className="flex gap-1.5">
      <Button size="sm" onClick={onReset}>
        Reset view
      </Button>
      <Button size="sm" onClick={onToggleRotate}>
        {autoRotate ? "Pause" : "Rotate"}
      </Button>
      <Button size="sm" aria-label="Zoom in" onClick={() => onZoom("in")}>
        +
      </Button>
      <Button size="sm" aria-label="Zoom out" onClick={() => onZoom("out")}>
        −
      </Button>
    </div>
    {landmarks || liveVitals || motion ? (
      <div role="group" aria-label="Show" className="flex gap-1.5">
        {landmarks ? (
          <Button
            size="sm"
            aria-pressed={landmarks.shown}
            onClick={landmarks.onToggle}
            className={PRESSED}
          >
            Landmarks
          </Button>
        ) : null}
        {liveVitals ? (
          <Button
            size="sm"
            aria-pressed={liveVitals.on}
            onClick={liveVitals.onToggle}
            className={PRESSED}
          >
            {LIVE_TOGGLE}
          </Button>
        ) : null}
        {motion
          ? motion.clips.map((clip) => (
              <Button
                key={clip}
                size="sm"
                aria-pressed={motion.clip === clip}
                disabled={motion.unavailable !== null}
                title={motion.unavailable ?? undefined}
                onClick={() => motion.onSelect(motion.clip === clip ? null : clip)}
                className={PRESSED}
              >
                {MOTION_LABEL[clip]}
              </Button>
            ))
          : null}
        {motion?.clip === "dance" ? (
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            {TEMPO_LABEL}
            <select
              value={motion.tempo}
              onChange={(event) => motion.onTempo(Number(event.target.value))}
              className="border-input bg-background text-foreground rounded-md border px-1 py-0.5 text-xs"
            >
              {DANCE_TEMPOS.map((bpm) => (
                <option key={bpm} value={bpm}>
                  {tempoOption(bpm)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    ) : null}
    {environment ? (
      <Button
        size="sm"
        // The one main action of the inline view; inside, the same button exits quietly.
        variant={environment.active ? "secondary" : "primary"}
        ref={environmentRef}
        onClick={environment.onToggle}
      >
        {environment.active ? EXIT_ENVIRONMENT : ENTER_ENVIRONMENT}
      </Button>
    ) : null}
  </div>
);
