"use client";

import { useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";

import { GlucoseControl, type GlucoseControlModel } from "../anatomy/glucose-control";
import { LIVE_TOGGLE } from "./live-copy";
import { HeartRateControl, type HeartRateControlModel } from "./heart-rate-control";

export type LiveVitalMode = "hr" | "glucose" | null;

export type LiveVitalsControlModel = Readonly<{
  mode: LiveVitalMode;
  onSelect: (mode: LiveVitalMode) => void;
  hrUnavailable: string | null;
  heartRate: HeartRateControlModel;
  glucose: GlucoseControlModel;
}>;

const PRESSED =
  "aria-pressed:border-primary aria-pressed:text-foreground aria-pressed:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]";

export const LiveVitalOptions = ({
  model,
  onInteract,
}: Readonly<{ model: LiveVitalsControlModel; onInteract?: () => void }>) => (
  <>
    <div role="group" aria-label="Live vital mode" className="flex gap-2">
      <Button
        size="sm"
        aria-pressed={model.mode === "hr"}
        disabled={model.hrUnavailable !== null && model.mode !== "hr"}
        title={model.hrUnavailable ?? undefined}
        className={PRESSED}
        onClick={() => {
          model.onSelect(model.mode === "hr" ? null : "hr");
          onInteract?.();
        }}
      >
        HR
      </Button>
      <Button
        size="sm"
        aria-pressed={model.mode === "glucose"}
        disabled={model.glucose.unavailable !== null && model.mode !== "glucose"}
        title={model.glucose.unavailable ?? undefined}
        className={PRESSED}
        onClick={() => {
          model.onSelect(model.mode === "glucose" ? null : "glucose");
          onInteract?.();
        }}
      >
        Glucose levels
      </Button>
    </div>
    {model.hrUnavailable ? (
      <p className="text-muted-foreground mt-2 text-xs">{model.hrUnavailable}</p>
    ) : null}
    {model.glucose.unavailable ? (
      <p className="text-muted-foreground mt-2 text-xs">{model.glucose.unavailable}</p>
    ) : null}
    {model.mode === "glucose" ? (
      <GlucoseControl control={model.glucose} onInteract={onInteract} />
    ) : null}
    {model.mode === "hr" ? (
      <HeartRateControl control={model.heartRate} onInteract={onInteract} />
    ) : null}
  </>
);

export const LiveVitalsControl = ({
  model,
  onInteract,
}: Readonly<{ model: LiveVitalsControlModel; onInteract?: () => void }>) => {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          ref={setTrigger}
          aria-pressed={model.mode !== null}
          className={PRESSED}
        >
          {LIVE_TOGGLE}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Live vitals options"
        className="p-3"
        container={trigger?.ownerDocument.fullscreenElement}
      >
        <LiveVitalOptions model={model} onInteract={onInteract} />
      </PopoverContent>
    </Popover>
  );
};
