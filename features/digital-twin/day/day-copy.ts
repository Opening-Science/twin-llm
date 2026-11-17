import { formatDate } from "@/infrastructure/format-measure";

/**
 * Copy for "Show me my day" on the Digital Twin page, in one place so
 * `lint:claims` sees it. Every line says what the data is and where it comes
 * from, never what it means for a person.
 */
export const DAY_SIGN_IN = "Sign in to see a synthetic day.";
export const DAY_NOT_FOUND = "No synthetic day for this person.";
export const DAY_FAILED = "Could not load this day.";
export const DAY_BAD_REQUEST = "Pick a day and a glucose profile.";

/** Why a day of a person was not built, one plain sentence each. */
export const DAY_REFUSED = {
  "no-readings": "No heart rate or glucose readings on this day.",
  "too-many": "Too many readings on this day to show.",
  units: "This day holds heart rate or glucose in another unit. Nothing is converted.",
} as const;

/** The panel under the twin. */
export const MY_DAY_TITLE = "Show me my day";
export const MY_DAY_NOTE =
  "One synthetic day of heart rate and blood glucose as beats, from the same steps as the show_my_day tool.";
export const MY_DAY_PICK = "Day";
export const MY_DAY_PROFILE = "Glucose thresholds";
export const MY_DAY_PROFILES = [
  { value: "without_diabetes", label: "Without diabetes" },
  { value: "with_diabetes", label: "With diabetes" },
] as const;
export const MY_DAY_MOCK_OPTION = "Illustrative day (mock)";
export const MY_DAY_MOCK_NOTE =
  "Illustrative mock: made-up values for a made-up person, not this person's readings.";
export const MY_DAY_LOADING = "Loading the day…";
export const MY_DAY_BEATS = "Beats of the day";
export const MY_DAY_NO_BEATS = "No beats on this day.";
export const MY_DAY_UTC = "Times are UTC.";
export const MY_DAY_NOT_RECORDED =
  "No activity is recorded for this day, so each beat reads “Reading”.";

/** The thresholds stay placeholders until the reviewer confirms them. */
export const myDayPlaceholder = (reviewer: string): string =>
  `Thresholds are placeholders until ${reviewer} confirms them.`;

/** One option of the day picker: the day and how many readings it holds. */
export const myDayOption = (day: string, readings: number): string =>
  `${formatDate(day)} · ${readings} ${readings === 1 ? "reading" : "readings"}`;

/** Under a pressed beat: what the twin now shows. */
export const myDayShows = (label: string): string => `The twin shows: ${label}.`;
export const MY_DAY_PICK_HINT =
  "Press a beat to turn the twin to it; press it again to let go.";
/** Before the organ's name where the viewer says what lit it. */
export const DAY_FOCUS_FROM = "From the day: ";

/** "Worth a look": stretches past a threshold, said in words beside the eye icon. */
export const WORTH_A_LOOK = "Worth a look";
export const WORTH_A_LOOK_NOTE = "A moment to look at, not a verdict on the person.";
export const WORTH_A_LOOK_NONE = "Nothing past the thresholds on this day.";

const MEASURE_NAME = { heart_rate: "Heart rate", glucose: "Blood glucose" } as const;

/** One window: when, which signal, and its furthest value past the threshold, as given. */
export const worthALookLine = (
  window: Readonly<{
    from: string;
    to: string;
    measure: "heart_rate" | "glucose";
    extreme: number;
    unit: string;
  }>,
): string =>
  `${window.from === window.to ? window.from : `${window.from} to ${window.to}`} · ${
    MEASURE_NAME[window.measure]
  } · furthest ${window.extreme} ${window.unit}`;

/** The button that turns the twin to a window's beat. */
export const worthALookShow = (from: string): string => `Show the ${from} beat`;

/** Why a week or month was not summarised. */
export const PERIOD_REFUSED = {
  "too-many": "Too many readings in this period to summarise.",
  units: "This period holds glucose in another unit. Nothing is converted.",
} as const;

/** The week or month card. */
export const PERIOD_TITLE = "Week and month";
export const PERIOD_PICK = "Period";
export const PERIOD_OPTIONS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;
export const PERIOD_MOCK =
  "The illustrative mock is a single day. Pick one of the person's days for a week or month ending on it.";
export const PERIOD_LOADING = "Loading the period…";

/** Stepping through the day. */
export const STEP_PREVIOUS = "Previous beat";
export const STEP_NEXT = "Next beat";
export const STEP_LABEL = "Step through the day";

/** Where the step is: "Beat 3 of 26, 08:15." or the hint before any beat is pressed. */
export const stepStatus = (
  selected: number | null,
  count: number,
  time: string | null,
): string =>
  selected === null || time === null
    ? `${count} ${count === 1 ? "beat" : "beats"}. Next beat starts at the first.`
    : `Beat ${selected + 1} of ${count}, ${time}.`;
