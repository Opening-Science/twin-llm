"use client";

import { Button } from "@/infrastructure/ui-kit/button";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import { PRESSED } from "../view-toolbar";
import {
  DAY_ABOUT,
  DAY_FAILED,
  DAY_FOLLOW,
  DAY_LOADING,
  DAY_NIGHT,
  DAY_NONE_DEMO,
  DAY_NONE_OTHER,
  DAY_NONE_SELF,
  DAY_PANEL,
  DAY_SELECT,
  dayOption,
} from "./motion-copy";
import { type DayMotionState } from "./use-day-motion";

const TIME_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "night", label: DAY_NIGHT },
] as const;

/** Why there is no day to follow, or null when there is one or it is loading. */
export const dayStatus = (state: DayMotionState): string | null => {
  if (state.subject === "other") return DAY_NONE_OTHER;
  if (state.days === undefined) return DAY_LOADING;
  if (state.days === null) return DAY_FAILED;
  if (state.days.length === 0) {
    return state.subject === "demo" ? DAY_NONE_DEMO : DAY_NONE_SELF;
  }
  return null;
};

/**
 * Under the twin: Follow day turns the day-driven motion on, then a day
 * select (newest first) and Day or Night. While motion cannot play (reduced
 * motion, no rig) the button is disabled and `unavailable` says why.
 */
export const DayMotionBar = ({
  state,
  unavailable,
}: Readonly<{ state: DayMotionState; unavailable: string | null }>) => {
  const status = state.following ? dayStatus(state) : null;
  return (
    <section className="twin-day" aria-label={DAY_PANEL}>
      <Button
        size="sm"
        variant="pill"
        aria-pressed={state.following}
        disabled={unavailable !== null}
        title={unavailable ?? undefined}
        onClick={() => state.onFollow(!state.following)}
        className={PRESSED}
      >
        {DAY_FOLLOW}
      </Button>
      {state.following ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">{DAY_ABOUT}</p>
          {status ? <p className="text-muted-foreground text-xs">{status}</p> : null}
          {state.days && state.days.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-muted-foreground flex items-center gap-1 text-xs">
                {DAY_SELECT}
                <select
                  value={state.selected?.day ?? ""}
                  onChange={(event) => state.onDay(event.target.value)}
                  className="border-input bg-background text-foreground rounded-md border px-1 py-0.5 text-xs"
                >
                  {state.days.map((day) => (
                    <option key={day.day} value={day.day}>
                      {dayOption(day)}
                    </option>
                  ))}
                </select>
              </label>
              <SegmentedControl
                label="Day or night"
                size="sm"
                options={TIME_OPTIONS}
                value={state.night ? "night" : "day"}
                onChange={(value) => state.onNight(value === "night")}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
