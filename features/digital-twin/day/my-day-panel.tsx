"use client";

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
  WORTH_A_LOOK,
  WORTH_A_LOOK_NONE,
  WORTH_A_LOOK_NOTE,
  worthALookLine,
  worthALookShow,
  myDayPlaceholder,
} from "./day-copy";
import { MOCK_CHOICE } from "./day-view";
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
 * Each beat is a toggle: pressed, the twin turns to the beat's organ at its
 * layer, and a line says what it shows; pressed again, the twin lets go.
 */
const BeatList = ({ state, day }: Readonly<{ state: MyDayState; day: KioskDay }>) =>
  day.beats.length === 0 ? (
    <p className="text-muted-foreground text-sm">{MY_DAY_NO_BEATS}</p>
  ) : (
    <ol className="twin-beats" aria-label={MY_DAY_BEATS}>
      {day.beats.map((beat, index) => {
        const pressed = state.selected === index;
        return (
          <li
            key={`${beat.time}-${index}`}
            className="twin-beat"
            data-worth={beat.worth_a_look ? "true" : undefined}
          >
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => state.onBeat(pressed ? null : index)}
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
                  <span className="text-xs font-medium">
                    {myDayShows(state.focus.label)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

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
        {day.worth_a_look.map((window) => {
          const index = day.beats.findIndex(
            (beat) =>
              beat.worth_a_look &&
              beat.time === window.from &&
              beat.measure === window.measure,
          );
          return (
            <li key={`${window.measure}-${window.from}`} className="flex flex-col gap-1">
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
          <BeatList state={state} day={state.day} />
        </>
      ) : state.days === undefined ? null : (
        <p className="text-muted-foreground text-xs">{MY_DAY_LOADING}</p>
      )}
    </section>
  );
};
