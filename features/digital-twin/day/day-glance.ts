import { formatDate } from "@/infrastructure/format-measure";
import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import {
  MY_DAY_MOCK_NOTE,
  MY_DAY_MOCK_OPTION,
  MY_DAY_UTC,
  worthALookLine,
} from "./day-copy";

/**
 * "Show me my day" at a glance, for the Dashboard page: whose day and which,
 * how many beats, and the first few windows worth a look, in the words the
 * Digital Twin page uses. Everything comes from the kiosk day as the server
 * built it; nothing here computes a value. Pure.
 */

export const DAY_GLANCE_SYNTHETIC = "Synthetic data";
export const DAY_GLANCE_NO_PEOPLE =
  "No synthetic people in this database yet, so there is no day to show here.";
export const DAY_GLANCE_FAILED =
  "Could not load the synthetic people, so there is no day to show here.";
export const DAY_GLANCE_TITLE = "Show me my day";

const SHOWN = 3;

export type DayGlance = Readonly<{
  heading: string;
  label: string;
  summary: string;
  worth: readonly string[];
  more: string | null;
  notes: readonly string[];
}>;

export const dayGlance = ({
  day,
  personLabel,
  mock,
}: Readonly<{ day: KioskDay; personLabel: string; mock: boolean }>): DayGlance => {
  const beats = day.beats.length;
  const windows = day.worth_a_look.length;
  const rest = windows - SHOWN;
  return {
    heading: mock ? MY_DAY_MOCK_OPTION : `${personLabel} · ${formatDate(day.day)}`,
    label: DAY_GLANCE_SYNTHETIC,
    summary: `${beats} ${beats === 1 ? "beat" : "beats"} of heart rate and blood sugar · ${
      windows === 0 ? "none" : windows
    } worth a look`,
    worth: day.worth_a_look.slice(0, SHOWN).map(worthALookLine),
    more: rest > 0 ? `and ${rest} more on the Digital Twin page` : null,
    notes: [...(mock ? [MY_DAY_MOCK_NOTE] : []), day.notice, MY_DAY_UTC],
  };
};
