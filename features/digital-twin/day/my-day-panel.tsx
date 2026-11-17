"use client";

import { type KioskDay } from "@/packages/query-tools/kiosk-day";
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
  MY_DAY_PROFILE,
  MY_DAY_PROFILES,
  MY_DAY_TITLE,
  MY_DAY_UTC,
  myDayOption,
  myDayPlaceholder,
} from "./day-copy";
import { MOCK_CHOICE } from "./day-view";
import { type MyDayState } from "./use-my-day";

/**
 * Under the twin: pick a day of the Demo person (or the illustrative mock day)
 * and the glucose thresholds, then read the day's beats in time order. Every
 * line is drawn as the route wrote it; the notice and the placeholder note
 * always show with a day.
 */

const TITLE_ID = "twin-my-day-title";

const BeatList = ({ day }: Readonly<{ day: KioskDay }>) =>
  day.beats.length === 0 ? (
    <p className="text-muted-foreground text-sm">{MY_DAY_NO_BEATS}</p>
  ) : (
    <ol className="twin-beats" aria-label={MY_DAY_BEATS}>
      {day.beats.map((beat, index) => (
        <li key={`${beat.time}-${index}`} className="twin-beat">
          <time className="twin-beat-time">{beat.time}</time>
          <div className="min-w-0">
            <p className="text-sm font-medium">{beat.event}</p>
            <p className="text-sm">{beat.line}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {beat.body.text}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );

const DayNotes = ({ day, mock }: Readonly<{ day: KioskDay; mock: boolean }>) => (
  <div className="text-muted-foreground flex flex-col gap-1 text-xs">
    {mock ? <p className="text-foreground font-medium">{MY_DAY_MOCK_NOTE}</p> : null}
    <p>{day.notice}</p>
    <p>
      {MY_DAY_UTC} {myDayPlaceholder(day.thresholds.reviewer)}
      {day.activity === "not recorded" ? ` ${MY_DAY_NOT_RECORDED}` : null}
    </p>
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
          <BeatList day={state.day} />
        </>
      ) : state.days === undefined ? null : (
        <p className="text-muted-foreground text-xs">{MY_DAY_LOADING}</p>
      )}
    </section>
  );
};
