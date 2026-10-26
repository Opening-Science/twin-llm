"use client";

import { useEffect, useMemo, useState } from "react";

import { TimeLineChart, type TimePoint } from "@/features/data-explorer/time-line-chart";
import { isoLocalDate } from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import {
  NIGHT_ABOUT,
  NIGHT_GAP,
  NIGHT_REDUCED_MOTION,
  NIGHT_TOGGLE,
  nightReadout,
} from "./live-copy";
import { type LiveVitals, NO_LIVE_VITALS } from "./live-rates";
import {
  advancePlayback,
  epochAt,
  epochIso,
  type Night,
  NIGHT_EPOCH_MINUTES,
  nightClock,
  nightMinutes,
  nightVitals,
  type Playback,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  seekPlayback,
  START_PLAYBACK,
  syntheticNight,
  togglePlayback,
} from "./night-series";

/** A clock tick: the cursor moves four times a second, and the twin's rate per epoch. */
const TICK_MS = 250;

export type NightPlaybackState = Readonly<{
  open: boolean;
  night: Night;
  playback: Playback;
  /** What drives the twin while open; no rates while closed. */
  vitals: LiveVitals;
  onOpen: (open: boolean) => void;
  onToggle: () => void;
  onSeek: (minute: number) => void;
  onSpeed: (speed: PlaybackSpeed) => void;
}>;

/**
 * The playback clock for the subject's synthetic night. It only runs while
 * open and playing, never with reduced motion, and its vitals change once
 * per five-minute epoch, so the twin re-reads its rates no faster than that.
 */
export const useNightPlayback = (
  seedKey: string,
  reducedMotion: boolean,
): NightPlaybackState => {
  const night = useMemo(() => syntheticNight(seedKey, isoLocalDate()), [seedKey]);
  const total = nightMinutes(night);
  const [open, setOpen] = useState(false);
  const [playback, setPlayback] = useState<Playback>(START_PLAYBACK);
  const running = open && playback.playing && !reducedMotion;

  useEffect(() => {
    if (!running) return;
    const last = { at: performance.now() };
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last.at;
      last.at = now;
      setPlayback((current) => advancePlayback(current, elapsed, total));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, total]);

  const epoch = epochAt(night, playback.minute);
  const vitals = useMemo(
    () => (open ? nightVitals(epoch, night.day) : NO_LIVE_VITALS),
    [open, epoch, night.day],
  );

  return {
    open,
    night,
    playback,
    vitals,
    onOpen: (next) => {
      setOpen(next);
      if (!next) setPlayback((current) => ({ ...current, playing: false }));
    },
    onToggle: () => setPlayback((current) => togglePlayback(current, total)),
    onSeek: (minute) => setPlayback((current) => seekPlayback(current, minute, total)),
    onSpeed: (speed) => setPlayback((current) => ({ ...current, speed })),
  };
};

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((speed) => ({
  value: String(speed) as `${PlaybackSpeed}`,
  label: `${speed}×`,
}));

const pointsOf = (night: Night, pick: "heart" | "breath"): readonly TimePoint[] =>
  night.epochs.flatMap((epoch) => {
    const value = epoch[pick];
    return value === null ? [] : [{ at: epochIso(night, epoch), value }];
  });

/** Index in `points` of the reading at `minute`, or null inside a gap. */
const pointIndex = (
  points: readonly TimePoint[],
  night: Night,
  minute: number,
): number | null => {
  const epoch = epochAt(night, minute);
  if (!epoch) return null;
  const at = epochIso(night, epoch);
  const index = points.findIndex((point) => point.at === at);
  return index === -1 ? null : index;
};

const minuteOf = (night: Night, point: TimePoint | undefined): number =>
  point ? (Date.parse(point.at) - Date.parse(night.startIso)) / 60_000 : 0;

/**
 * The scrubber under the twin: play or pause, speed, a slider over the night,
 * and two charts whose cursor follows the same clock as the twin. Pressing on
 * a chart seeks too.
 */
export const NightPlayback = ({
  state,
  reducedMotion,
}: Readonly<{ state: NightPlaybackState; reducedMotion: boolean }>) => {
  const { open, night, playback } = state;
  const heart = useMemo(() => pointsOf(night, "heart"), [night]);
  const breath = useMemo(() => pointsOf(night, "breath"), [night]);
  const total = nightMinutes(night);
  const epoch = epochAt(night, playback.minute);
  const clock = nightClock(night, playback.minute);
  const gap = epoch !== null && epoch.heart === null;
  const breakOverMs = NIGHT_EPOCH_MINUTES * 60_000;

  return (
    <section className="twin-night" aria-label={NIGHT_TOGGLE}>
      <Button
        size="sm"
        variant="pill"
        aria-expanded={open}
        onClick={() => state.onOpen(!open)}
      >
        {NIGHT_TOGGLE}
      </Button>
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">{NIGHT_ABOUT}</p>
          {reducedMotion ? (
            <p className="text-muted-foreground text-xs">{NIGHT_REDUCED_MOTION}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={reducedMotion} onClick={state.onToggle}>
              {playback.playing && !reducedMotion ? "Pause" : "Play"}
            </Button>
            <SegmentedControl
              label="Playback speed"
              size="sm"
              options={SPEED_OPTIONS}
              value={`${playback.speed}`}
              onChange={(value) => state.onSpeed(Number(value) as PlaybackSpeed)}
            />
            <p className="font-mono text-xs tabular-nums" aria-live="off">
              {nightReadout(clock, epoch)}
            </p>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={total - NIGHT_EPOCH_MINUTES}
            step={NIGHT_EPOCH_MINUTES}
            value={
              Math.floor(playback.minute / NIGHT_EPOCH_MINUTES) * NIGHT_EPOCH_MINUTES
            }
            aria-label="Time in the night"
            aria-valuetext={nightReadout(clock, epoch)}
            onChange={(event) => state.onSeek(Number(event.target.value))}
          />
          {gap ? <p className="text-muted-foreground text-xs">{NIGHT_GAP}</p> : null}
          <TimeLineChart
            points={heart}
            unit="bpm"
            decimals={0}
            label="Heart rate over the synthetic night"
            height={140}
            timeAxis="hours"
            breakOverMs={breakOverMs}
            cursorIndex={pointIndex(heart, night, playback.minute)}
            onSeek={(index) => state.onSeek(minuteOf(night, heart[index]))}
          />
          <TimeLineChart
            points={breath}
            unit="/min"
            decimals={1}
            label="Breathing rate over the synthetic night"
            height={110}
            timeAxis="hours"
            breakOverMs={breakOverMs}
            cursorIndex={pointIndex(breath, night, playback.minute)}
            onSeek={(index) => state.onSeek(minuteOf(night, breath[index]))}
          />
        </div>
      ) : null}
    </section>
  );
};
