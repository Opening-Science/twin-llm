/**
 * The two windows `values_around_event` reads: `days_before` days ending just
 * before the event and `days_after` days starting at it. Pure, in UTC, so the
 * windows never depend on the server's time zone.
 */
const MS_PER_DAY = 86_400_000;

export type EventWindows = Readonly<{
  before: Readonly<{ start: string; end: string }>;
  after: Readonly<{ start: string; end: string }>;
}>;

export const eventWindows = (
  at: Date,
  daysBefore: number,
  daysAfter: number,
): EventWindows => {
  const t = at.getTime();
  return {
    before: {
      start: new Date(t - daysBefore * MS_PER_DAY).toISOString(),
      // One millisecond before the event: a reading at the event's instant counts as after.
      end: new Date(t - 1).toISOString(),
    },
    after: {
      start: new Date(t).toISOString(),
      end: new Date(t + daysAfter * MS_PER_DAY).toISOString(),
    },
  };
};

/** The earliest dated record, a tie at one instant to the lower id; null when none is dated. */
export const firstDated = <T extends Readonly<{ id: string }>>(
  records: readonly T[],
  dateOf: (record: T) => Date | null,
): (T & Readonly<{ at: Date }>) | null =>
  records
    .flatMap((record) => {
      const at = dateOf(record);
      return at === null ? [] : [{ ...record, at }];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : 1))[0] ?? null;
