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
export const MY_DAY_NOTE = "Your day of heart rate and blood sugar, step by step.";
export const MY_DAY_DAYS_FAILED =
  "Could not load this person's days, so only the illustrative day is offered.";
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
