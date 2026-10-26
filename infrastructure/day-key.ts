/**
 * Calendar-day keys (YYYY-MM-DD) for grouping data. Data, not display:
 * `formatDate` turns them into text people read.
 */

/** The date part of an ISO timestamp as sent, or "unknown" when there is none. */
export const dayKey = (iso?: string | null): string =>
  iso ? iso.slice(0, 10) : "unknown";

/** The UTC calendar day of `date`. Not "today" for a viewer: use `isoLocalDate`. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);
