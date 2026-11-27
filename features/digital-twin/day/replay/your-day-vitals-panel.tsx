"use client";

import { useId, useMemo, useState } from "react";

import { formatNumber } from "@/infrastructure/format-measure";
import { localClock } from "@/packages/query-tools/replay/local-time";

import { GLUCOSE_NOT_INSTALLED } from "../../anatomy/glucose-control";
import { type GlucoseStatus } from "../../anatomy/glucose-flow";
import { useReplaySnapshot } from "../../replay/replay-provider";
import { type YourDayCameraRequest } from "../your-day-camera";
import { YourDayViewer } from "../your-day-viewer";
import {
  availableVitalSeries,
  glucoseParticleDensity,
  vitalReadingAt,
  type VitalSeries,
} from "./your-day-vitals";

const LABEL = { heart: "Heart rate", blood: "Blood glucose", sensor: "Sensor glucose" };

function VitalReadout({
  group,
  options,
  selected,
  onSelect,
  cursorMs,
  zone,
}: Readonly<{
  group: "heart" | "glucose";
  options: readonly VitalSeries[];
  selected: VitalSeries | undefined;
  onSelect: (id: string) => void;
  cursorMs: number;
  zone: string;
}>) {
  const id = useId();
  const state = vitalReadingAt(selected, cursorMs);
  const label = group === "heart" ? "Heart rate" : "Glucose";
  const at =
    state.state === "unavailable"
      ? null
      : localClock(new Date(state.reading.at), zone).time;
  const source =
    state.state === "unavailable" ? selected?.source : state.reading.source.name;
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">{selected ? LABEL[selected.metric] : label}</p>
      {options.length > 1 && (
        <div className="mt-1">
          <label htmlFor={id} className="sr-only">
            {label} animation source
          </label>
          <select
            id={id}
            className="bg-card border-input w-full rounded-md border px-1 py-1 text-xs"
            value={selected?.id ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            {options.map((option, index) => (
              <option key={option.id} value={option.id}>
                {LABEL[option.metric]} · {option.source}
                {options.some(
                  (entry) =>
                    entry.id !== option.id &&
                    entry.metric === option.metric &&
                    entry.source === option.source,
                )
                  ? ` (${index + 1})`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="mt-1 text-sm tabular-nums">
        {state.state === "available"
          ? `${formatNumber(state.reading.value, Number.isInteger(state.reading.value) ? 0 : 1)} ${group === "heart" ? "bpm" : "mg/dL"}`
          : "No current reading"}
      </p>
      <p className="text-muted-foreground text-xs">
        {state.state === "stale"
          ? `Last recorded at ${at}`
          : state.state === "available"
            ? `${source} · ${at}`
            : state.text}
      </p>
    </div>
  );
}

export function YourDayVitalsPanel({
  series,
  reducedMotion,
  personal,
  cameraRequest,
}: Readonly<{
  series: ReadonlyMap<string, VitalSeries>;
  reducedMotion: boolean;
  personal: boolean;
  cameraRequest?: YourDayCameraRequest;
}>) {
  const { cursorMs, selection, status } = useReplaySnapshot();
  const [heartId, setHeart] = useState("");
  const [glucoseId, setGlucose] = useState("");
  const [glucoseStatus, setGlucoseStatus] = useState<GlucoseStatus>("idle");
  const [retry, setRetry] = useState(0);
  const hearts = useMemo(() => availableVitalSeries(series.values(), "heart"), [series]);
  const glucoses = useMemo(
    () => availableVitalSeries(series.values(), "glucose"),
    [series],
  );
  const heart = hearts.find(({ id }) => id === heartId) ?? hearts[0];
  const glucose =
    glucoses.find(({ id }) => id === glucoseId) ??
    glucoses.find(({ metric }) => metric === "sensor") ??
    glucoses[0];
  const hr = vitalReadingAt(heart, cursorMs);
  const level = vitalReadingAt(glucose, cursorMs);
  const density = glucoseParticleDensity(
    level.state === "available" ? level.reading.value : null,
  );
  const glucoseModel = useMemo(
    () => ({
      density,
      status: glucoseStatus,
      onStatus: setGlucoseStatus,
      retry,
    }),
    [density, glucoseStatus, retry],
  );

  return (
    <div className="flex flex-col gap-2 p-2">
      <YourDayViewer
        playing={status === "playing"}
        reducedMotion={reducedMotion}
        bpm={hr.state === "available" ? hr.reading.value : null}
        glucose={glucose ? glucoseModel : null}
        showVitals={heart !== undefined || glucose !== undefined}
        cameraRequest={cameraRequest}
      />
      {personal && (
        <section aria-label="Replay vitals" className="space-y-2 px-2 pb-2">
          <p className="text-eyebrow">Personal readings</p>
          <div className="grid gap-2 @min-[20rem]:grid-cols-2">
            <VitalReadout
              group="heart"
              options={hearts}
              selected={heart}
              onSelect={setHeart}
              cursorMs={cursorMs}
              zone={selection.time_zone}
            />
            <VitalReadout
              group="glucose"
              options={glucoses}
              selected={glucose}
              onSelect={setGlucose}
              cursorMs={cursorMs}
              zone={selection.time_zone}
            />
          </div>
          {glucose && (
            <p className="text-muted-foreground text-xs">
              Illustrative particles, not measured glucose particles or blood velocity.
            </p>
          )}
        </section>
      )}
      {glucose && glucoseStatus === "missing" && (
        <p className="text-muted-foreground text-xs">{GLUCOSE_NOT_INSTALLED}</p>
      )}
      {glucose && glucoseStatus === "error" && (
        <p role="status" className="text-muted-foreground text-xs">
          Could not load the particles.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
