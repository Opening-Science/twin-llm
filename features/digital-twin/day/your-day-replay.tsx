"use client";

import { Dumbbell, PersonStanding, type LucideIcon } from "lucide-react";
import { useMemo } from "react";

import { localClock } from "@/packages/query-tools/replay/local-time";
import { useReplayActions, useReplaySnapshot } from "../replay/replay-provider";
import {
  activeTimelineEvents,
  EVENT_KINDS,
  snapTimelineSeek,
  timelineSegments,
  type TimelineEvent,
  type TimelineKind,
  type YourDayReplayData,
} from "./your-day-replay-events";
import styles from "./your-day-replay.module.css";

const STYLES = {
  workout: { label: "Workout", icon: Dumbbell, color: "text-chart-2" },
  activity: { label: "Activity", icon: PersonStanding, color: "text-chart-1" },
  sleep: { label: "Sleep", icon: "☾", color: "text-chart-4" },
  heart: { label: "Heart rate", icon: "♥", color: "text-chart-3" },
  glucose: { label: "Glucose", icon: "◆", color: "text-chart-2" },
} satisfies Record<
  TimelineKind,
  { label: string; icon: string | LucideIcon; color: string }
>;

const timeAt = (ms: number, zone: string) => localClock(new Date(ms), zone).time;
const control =
  "border-input hover:bg-muted focus-visible:outline-ring rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

function EventIcon({ kind }: Readonly<{ kind: TimelineKind }>) {
  const { icon: Icon, color } = STYLES[kind];
  if (typeof Icon === "string") {
    return (
      <span aria-hidden="true" className={color}>
        {Icon}
      </span>
    );
  }
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      className={`inline-block size-3.5 align-middle ${color}`}
    />
  );
}

export function YourDayReplayClock({
  data,
}: Readonly<{ data: YourDayReplayData | null }>) {
  const { cursorMs, selection } = useReplaySnapshot();
  const active = data ? activeTimelineEvents(data.events, cursorMs) : [];
  const primary = active[0];
  const activeKinds = [...new Set(active.map(({ kind }) => kind))].reverse();
  return (
    <div className="bg-muted flex h-10 shrink-0 items-center gap-2 rounded-xl px-3">
      <h2 id="your-day-title" className="sr-only">
        Replay Clock
      </h2>
      <span aria-hidden="true" className="flex w-13 shrink-0 items-center justify-start">
        {activeKinds.length === 0 && (
          <span className="bg-card text-muted-foreground grid size-5 place-items-center rounded-full border border-current">
            <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {activeKinds.map((kind) => (
          <span
            key={kind}
            className={`bg-card relative grid size-5 shrink-0 place-items-center rounded-full border border-current text-xs leading-none not-first:-ml-3 ${STYLES[kind].color}`}
          >
            <EventIcon kind={kind} />
          </span>
        ))}
      </span>
      <span
        className={`font-mono text-xl font-semibold whitespace-nowrap tabular-nums ${primary ? STYLES[primary.kind].color : "text-foreground"}`}
      >
        {data ? timeAt(cursorMs, selection.time_zone) : "--:--"}
      </span>
      <span className="sr-only">
        {active.length
          ? active.map(({ kind, label }) => `${STYLES[kind].label}: ${label}`).join("; ")
          : data
            ? "No active event"
            : "No replay data"}
      </span>
    </div>
  );
}

export function YourDayReplay({ data }: Readonly<{ data: YourDayReplayData | null }>) {
  const { cursorMs, startMs, endMs, selection, speed, status } = useReplaySnapshot();
  const { play, pause, replay, seek, setSpeed, step } = useReplayActions();
  const segments = useMemo(
    () => timelineSegments(data?.events ?? [], startMs, endMs),
    [data, startMs, endMs],
  );
  if (!data) {
    return (
      <section aria-labelledby="your-day-replay" className="surface p-4">
        <h3 id="your-day-replay" className="font-medium">
          Daily replay
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          No demo replay data for this date.
        </p>
      </section>
    );
  }
  const { events, notice } = data;
  const zone = selection.time_zone;
  const atEnd = cursorMs === endMs - 1;
  const position = (ms: number) =>
    ((Math.min(endMs, Math.max(startMs, ms)) - startMs) / (endMs - startMs)) * 100;
  const eventTime = (event: TimelineEvent) =>
    timeAt(Math.max(startMs, event.start), zone);
  const eventLabel = (event: TimelineEvent) =>
    `Seek to ${STYLES[event.kind].label}: ${event.label}, ${eventTime(event)}`;
  const jump = (event: TimelineEvent) => seek(event.start);
  const active = activeTimelineEvents(events, cursorMs)[0];
  const eventRange = (event: TimelineEvent) =>
    `${eventTime(event)}${event.end > event.start ? `–${timeAt(Math.min(endMs - 1, event.end), zone)}` : ""}`;
  const playLabel = status === "playing" ? "Pause" : atEnd ? "Replay" : "Play";

  return (
    <section
      aria-labelledby="your-day-replay"
      className="dark surface text-foreground @container p-4 @lg:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 id="your-day-replay" className="font-medium">
            Daily replay
          </h3>
          {notice && (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
              Demo data
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground mr-1 text-xs tabular-nums">
            {timeAt(cursorMs, zone)} / {timeAt(endMs - 1, zone)}
          </span>
          <button
            type="button"
            className="bg-foreground text-background hover:bg-foreground/85 focus-visible:outline-ring grid size-8 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={playLabel}
            title={playLabel}
            onClick={status === "playing" ? pause : atEnd ? replay : play}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
              {playLabel === "Pause" ? (
                <path d="M4 3h3v10H4zm5 0h3v10H9z" />
              ) : playLabel === "Replay" ? (
                <path d="M8 3a5 5 0 1 1-4.9 6h1.6A3.5 3.5 0 1 0 8 4.5H6.5l2 2H6.4L3.2 3.3 6.4 0h2.1l-3 3z" />
              ) : (
                <path d="M5 2.5 13 8l-8 5.5z" />
              )}
            </svg>
          </button>
          <select
            aria-label="Replay speed"
            className={`bg-card ${control}`}
            value={speed}
            onChange={(event) =>
              setSpeed(event.currentTarget.value === "fast" ? "fast" : "default")
            }
          >
            <option value="default">1×</option>
            <option value="fast">Fast</option>
          </select>
        </div>
      </div>
      <div className="mt-3 px-1.5">
        <div className="relative">
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2"
            aria-hidden="true"
            data-replay-track
          >
            {segments.map((segment) => (
              <span
                key={segment.start}
                className="min-w-0 px-px"
                style={{ width: `${position(segment.end) - position(segment.start)}%` }}
              >
                <span
                  className={`block h-full rounded-[3px] ${segment.event ? `${STYLES[segment.event.kind].color} bg-current` : "bg-muted"}`}
                />
              </span>
            ))}
          </div>
          <input
            type="range"
            aria-label="Seek replay time"
            aria-valuetext={`${timeAt(cursorMs, zone)} (${localClock(new Date(cursorMs), zone).offset})`}
            className={`${styles.seek} focus-visible:outline-ring relative block h-8 w-full cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2`}
            min={0}
            max={endMs - startMs - 1}
            value={cursorMs - startMs}
            onChange={(event) =>
              seek(
                snapTimelineSeek(
                  startMs + event.currentTarget.valueAsNumber,
                  events,
                  startMs,
                  endMs,
                ),
              )
            }
            onKeyDown={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowDown" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowUp"
              ) {
                event.preventDefault();
                step(event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1);
              }
            }}
          />
          <span
            aria-hidden="true"
            className="bg-foreground pointer-events-none absolute top-1/2 h-7 w-0.5 -translate-1/2"
            style={{ left: `${position(cursorMs)}%` }}
          >
            <span className="border-card bg-foreground absolute top-1/2 left-1/2 size-2.5 -translate-1/2 rounded-full border-2" />
          </span>
        </div>
        <div
          aria-hidden="true"
          className="text-muted-foreground relative h-5 text-[0.6875rem] tabular-nums @lg:text-xs"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((tick) => (
            <span
              key={tick}
              className={
                tick === 0
                  ? "absolute left-0"
                  : tick === 8
                    ? "absolute right-0"
                    : `absolute -translate-x-1/2 ${tick % 2 ? "hidden @lg:inline" : ""}`
              }
              style={tick > 0 && tick < 8 ? { left: `${tick * 12.5}%` } : undefined}
            >
              {timeAt(
                tick === 8 ? endMs - 1 : startMs + ((endMs - startMs) * tick) / 8,
                zone,
              )}
            </span>
          ))}
        </div>
        {events.length > 0 && (
          <div className="relative">
            {(["heart", "glucose"] as const).map((kind) => (
              <div key={kind} className="relative h-4">
                {events
                  .filter((event) => event.kind === kind)
                  .map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      aria-label={eventLabel(event)}
                      title={eventLabel(event)}
                      className="focus-visible:outline-ring hover:bg-muted absolute inset-y-0 min-w-4 -translate-x-1/2 rounded-sm text-xs leading-4 focus-visible:z-20 focus-visible:outline-2"
                      style={{ left: `${position(event.start)}%` }}
                      onClick={() => jump(event)}
                    >
                      <EventIcon kind={kind} />
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {events.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {active ? (
            <button
              type="button"
              className="focus-visible:outline-ring flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-sm text-left text-xs hover:underline focus-visible:outline-2"
              aria-label={eventLabel(active)}
              onClick={() => jump(active)}
            >
              <EventIcon kind={active.kind} />
              <span className="font-medium">{active.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {eventRange(active)}
              </span>
            </button>
          ) : (
            <p className="text-muted-foreground text-xs">No active event</p>
          )}
          <ul
            aria-label="Event types"
            className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs"
          >
            {EVENT_KINDS.map((kind) => (
              <li key={kind}>
                <EventIcon kind={kind} /> {STYLES[kind].label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">No events for this day.</p>
      )}
    </section>
  );
}
