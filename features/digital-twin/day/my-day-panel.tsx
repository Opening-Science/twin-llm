"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { type KioskDay } from "@/packages/query-tools/kiosk-day";
import { Button } from "@/infrastructure/ui-kit/button";
import { EyeIcon } from "@/infrastructure/ui-kit/icons";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import {
  MY_DAY_BEATS,
  MY_DAY_DAYS_FAILED,
  MY_DAY_LOADING,
  MY_DAY_MOCK_NOTE,
  MY_DAY_MOCK_OPTION,
  MY_DAY_NO_BEATS,
  MY_DAY_NOT_RECORDED,
  MY_DAY_NOTE,
  MY_DAY_PICK,
  MY_DAY_PICK_HINT,
  MY_DAY_PROFILE,
  MY_DAY_PROFILES,
  MY_DAY_TITLE,
  MY_DAY_UTC,
  myDayOption,
  myDayShows,
  runFold,
  runLine,
  runOpen,
  STEP_KEYS,
  STEP_LABEL,
  STEP_NEXT,
  STEP_PREVIOUS,
  stepStatus,
  WORTH_A_LOOK,
  WORTH_A_LOOK_NONE,
  WORTH_A_LOOK_NOTE,
  worthALookLine,
  worthALookShow,
  myDayPlaceholder,
} from "./day-copy";
import { type KioskBeat } from "./beat-focus";
import { type BeatRow, beatRows } from "./beat-runs";
import { keyStep, stepBeat } from "./beat-step";
import { MOCK_CHOICE } from "./day-view";
import { PeriodCard } from "./period-card";
import { type MyDayState } from "./use-my-day";

/**
 * Under the twin: pick a day of the Demo person (or the illustrative mock day)
 * and the glucose thresholds, then read the day's beats in time order; a beat
 * pressed turns the twin to its organ. Every
 * line is drawn as the route wrote it; the notice and the placeholder note
 * always show with a day.
 */

const TITLE_ID = "twin-my-day-title";

/**
 * Above the beats, which scroll in their own box: Previous and Next
 * step through the day one beat at a time, and a line says where the step is.
 */
const StepBar = ({ state, day }: Readonly<{ state: MyDayState; day: KioskDay }>) => {
  const count = day.beats.length;
  const time = state.selected === null ? null : (day.beats[state.selected]?.time ?? null);
  return (
    <div className="twin-step" role="group" aria-label={STEP_LABEL}>
      <Button
        size="sm"
        variant="pill"
        disabled={state.selected === 0}
        onClick={() => state.onBeat(stepBeat(state.selected, count, "previous"))}
      >
        {STEP_PREVIOUS}
      </Button>
      <Button
        size="sm"
        variant="pill"
        disabled={state.selected === count - 1}
        onClick={() => state.onBeat(stepBeat(state.selected, count, "next"))}
      >
        {STEP_NEXT}
      </Button>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {stepStatus(state.selected, count, time)}
      </p>
    </div>
  );
};

/**
 * Each beat is a toggle: pressed, the twin turns to the beat's organ at its
 * layer, and a line says what it shows; pressed again, the twin lets go. On a
 * beat, the arrow keys, Home and End step and move the focus with it.
 */
const BeatItem = ({
  state,
  beat,
  index,
  onKey,
}: Readonly<{
  state: MyDayState;
  beat: KioskBeat;
  index: number;
  onKey: (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => void;
}>) => {
  const pressed = state.selected === index;
  return (
    <li
      className="twin-beat"
      data-beat={index}
      data-worth={beat.worth_a_look ? "true" : undefined}
    >
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => state.onBeat(pressed ? null : index)}
        onKeyDown={onKey(index)}
        className="twin-beat-button"
      >
        <time className="twin-beat-time">{beat.time}</time>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1 text-sm font-medium">
            {beat.worth_a_look ? <EyeIcon /> : null}
            {beat.event}
          </span>
          <span className="text-sm">{beat.line}</span>
          <span className="text-muted-foreground text-xs leading-relaxed">
            {beat.body.text}
          </span>
          {pressed && state.focus ? (
            <span className="text-xs font-medium">{myDayShows(state.focus.label)}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
};

/**
 * A run of steady readings, folded: one line per measure and a button that
 * opens it. Open, it is a button to fold it again above its beats.
 */
const RunItem = ({
  run,
  open,
  onToggle,
}: Readonly<{
  run: Extract<BeatRow, { kind: "run" }>;
  open: boolean;
  onToggle: () => void;
}>) => {
  const count = run.last - run.first + 1;
  return (
    <li className="twin-beat twin-run">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="twin-beat-button"
      >
        <span className="twin-beat-time" aria-hidden="true">
          {open ? "" : "···"}
        </span>
        <span className="flex min-w-0 flex-col">
          {open
            ? null
            : run.lines.map((line) => (
                <span key={line.name} className="text-sm">
                  {runLine(line)}
                </span>
              ))}
          <span className="text-muted-foreground text-xs">
            {open ? runFold(count) : runOpen(count)}
          </span>
        </span>
      </button>
    </li>
  );
};

const BeatList = ({ state, day }: Readonly<{ state: MyDayState; day: KioskDay }>) => {
  const listRef = useRef<HTMLOListElement | null>(null);
  const focusNext = useRef<number | null>(null);
  const rows = useMemo(() => beatRows(day.beats), [day.beats]);
  // Runs opened by hand, for this day only; a run holding the stepped-to beat is open too.
  const [opened, setOpened] = useState<
    Readonly<{ beats: KioskDay["beats"]; firsts: readonly number[] }>
  >({
    beats: day.beats,
    firsts: [],
  });
  const firsts = opened.beats === day.beats ? opened.firsts : [];
  const isOpen = (run: Extract<BeatRow, { kind: "run" }>) =>
    firsts.includes(run.first) ||
    (state.selected !== null &&
      state.selected >= run.first &&
      state.selected <= run.last);
  const toggle = (run: Extract<BeatRow, { kind: "run" }>) => {
    const open = isOpen(run);
    // Folding a run that holds the pressed beat lets that beat go.
    if (
      open &&
      state.selected !== null &&
      state.selected >= run.first &&
      state.selected <= run.last
    ) {
      state.onBeat(null);
    }
    setOpened({
      beats: day.beats,
      firsts: open ? firsts.filter((one) => one !== run.first) : [...firsts, run.first],
    });
  };
  // The stepped-to beat stays in view in the beats' own box, and takes the focus after a key.
  useEffect(() => {
    if (state.selected === null) return;
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-beat="${state.selected}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
    if (focusNext.current === state.selected) {
      item?.querySelector<HTMLButtonElement>("button")?.focus();
      focusNext.current = null;
    }
  }, [state.selected]);
  const onKey = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = keyStep(event.key);
    if (step === null) return;
    const next = stepBeat(index, day.beats.length, step);
    if (next === null) return;
    event.preventDefault();
    focusNext.current = next;
    state.onBeat(next);
  };
  if (day.beats.length === 0) {
    return <p className="text-muted-foreground text-sm">{MY_DAY_NO_BEATS}</p>;
  }
  return (
    <>
      <StepBar state={state} day={day} />
      <ol ref={listRef} className="twin-beats" aria-label={MY_DAY_BEATS}>
        {rows.flatMap((row) => {
          if (row.kind === "beat") {
            return [
              <BeatItem
                key={row.index}
                state={state}
                beat={day.beats[row.index]!}
                index={row.index}
                onKey={onKey}
              />,
            ];
          }
          const open = isOpen(row);
          const head = (
            <RunItem
              key={`run-${row.first}`}
              run={row}
              open={open}
              onToggle={() => toggle(row)}
            />
          );
          if (!open) return [head];
          return [
            head,
            ...day.beats
              .slice(row.first, row.last + 1)
              .map((beat, offset) => (
                <BeatItem
                  key={row.first + offset}
                  state={state}
                  beat={beat}
                  index={row.first + offset}
                  onKey={onKey}
                />
              )),
          ];
        })}
      </ol>
      <p className="text-muted-foreground text-xs">{STEP_KEYS}</p>
    </>
  );
};

const WORTH_ID = "twin-worth-title";

/**
 * The day's windows past a threshold, in words with an eye icon, never by
 * colour alone. Each names its time, signal, furthest value and rule as the
 * server wrote them, and can turn the twin to its beat.
 */
const WorthALook = ({ state, day }: Readonly<{ state: MyDayState; day: KioskDay }>) => (
  <section className="twin-worth" aria-labelledby={WORTH_ID}>
    <h4 id={WORTH_ID} className="flex items-center gap-1 text-sm font-medium">
      <EyeIcon />
      {WORTH_A_LOOK}
    </h4>
    <p className="text-muted-foreground text-xs">{WORTH_A_LOOK_NOTE}</p>
    {day.worth_a_look.length === 0 ? (
      <p className="text-muted-foreground text-xs">{WORTH_A_LOOK_NONE}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {day.worth_a_look.map((window, at) => {
          // Blood and sensor glucose can both pass at the same time; the value tells them apart.
          const atTime = (beat: KioskDay["beats"][number]) =>
            beat.worth_a_look &&
            beat.time === window.from &&
            beat.measure === window.measure;
          const exact = day.beats.findIndex(
            (beat) => atTime(beat) && beat.value === window.extreme,
          );
          const index = exact >= 0 ? exact : day.beats.findIndex(atTime);
          return (
            <li
              key={`${window.measure}-${window.from}-${at}`}
              className="flex flex-col gap-1"
            >
              <p className="text-sm">{worthALookLine(window)}</p>
              <p className="text-muted-foreground text-xs">{window.rule}</p>
              {index >= 0 ? (
                <Button
                  size="sm"
                  variant="pill"
                  className="self-start"
                  aria-pressed={state.selected === index}
                  onClick={() => state.onBeat(state.selected === index ? null : index)}
                >
                  {worthALookShow(window.from)}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

const DayNotes = ({ day, mock }: Readonly<{ day: KioskDay; mock: boolean }>) => (
  <div className="text-muted-foreground flex flex-col gap-1 text-xs">
    {mock ? <p className="text-foreground font-medium">{MY_DAY_MOCK_NOTE}</p> : null}
    <p>{day.notice}</p>
    <p>
      {MY_DAY_UTC} {myDayPlaceholder(day.thresholds.reviewer)}
      {day.activity === "not recorded" ? ` ${MY_DAY_NOT_RECORDED}` : null}
    </p>
    <p>{MY_DAY_PICK_HINT}</p>
  </div>
);

export const MyDayPanel = ({ state }: Readonly<{ state: MyDayState }>) => {
  const mock = state.choice === MOCK_CHOICE;
  return (
    <section className="twin-my-day" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="text-base font-medium">
        {MY_DAY_TITLE}
      </h3>
      <p className="text-muted-foreground text-xs">{MY_DAY_NOTE}</p>
      {state.days === null ? (
        <p className="text-muted-foreground text-xs">{MY_DAY_DAYS_FAILED}</p>
      ) : null}
      {state.days === undefined ? (
        <p className="text-muted-foreground text-xs">{MY_DAY_LOADING}</p>
      ) : (
        <div className="twin-my-day-controls">
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            {MY_DAY_PICK}
            <select
              value={state.choice}
              onChange={(event) => state.onChoice(event.target.value)}
              className="border-input bg-background text-foreground rounded-md border px-1 py-0.5 text-xs"
            >
              {(state.days ?? []).map((entry) => (
                <option key={entry.day} value={entry.day}>
                  {myDayOption(entry.day, entry.readings)}
                </option>
              ))}
              <option value={MOCK_CHOICE}>{MY_DAY_MOCK_OPTION}</option>
            </select>
          </label>
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <span aria-hidden="true">{MY_DAY_PROFILE}</span>
            <SegmentedControl
              label={MY_DAY_PROFILE}
              size="sm"
              options={MY_DAY_PROFILES}
              value={state.profile}
              onChange={state.onProfile}
            />
          </div>
        </div>
      )}
      {state.error ? (
        <p className="text-muted-foreground text-sm">{state.error}</p>
      ) : state.day ? (
        <>
          <DayNotes day={state.day} mock={mock} />
          <WorthALook state={state} day={state.day} />
          <PeriodCard state={state.period} />
          <BeatList state={state} day={state.day} />
        </>
      ) : state.days === undefined ? null : (
        <p className="text-muted-foreground text-xs">{MY_DAY_LOADING}</p>
      )}
    </section>
  );
};
