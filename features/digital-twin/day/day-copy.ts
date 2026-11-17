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
