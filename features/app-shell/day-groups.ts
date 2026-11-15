import type { RecentThread } from "@/infrastructure/recent-threads";

/**
 * The sidebar's thread groups: Today, This week and Earlier, by calendar day
 * in the viewer's own time zone. "Today" starts at local midnight, "This week"
 * is the six calendar days before it, everything older is "Earlier"; never a
 * rolling 24 hours. Pure: the clock and the zone come in as values.
 */

export type DayGroupLabel = "Today" | "This week" | "Earlier";

export type DayGroup = Readonly<{
  label: DayGroupLabel;
  threads: readonly RecentThread[];
}>;

export type ViewerDay = Readonly<{
  /** The viewer's calendar date, `YYYY-MM-DD`. */
  today: string;
  /** An IANA zone, such as `Europe/Zurich`. */
  timeZone: string;
}>;

const ORDER: readonly DayGroupLabel[] = ["Today", "This week", "Earlier"];
const WEEK_DAYS = 6;
const DAY_MS = 86_400_000;

const dayFormats = new Map<string, Intl.DateTimeFormat>();

const dayFormat = (timeZone: string): Intl.DateTimeFormat => {
  const known = dayFormats.get(timeZone);
  if (known !== undefined) return known;
  // en-CA writes dates as YYYY-MM-DD.
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dayFormats.set(timeZone, created);
  return created;
};

/** The calendar date of `moment` in `timeZone`, `YYYY-MM-DD`. */
export const dayKey = (moment: Date, timeZone: string): string =>
  dayFormat(timeZone).format(moment);

const keyToUtc = (key: string): number => {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

/** Whole calendar days from `earlier` to `later`. */
const daysBetween = (later: string, earlier: string): number =>
  Math.round((keyToUtc(later) - keyToUtc(earlier)) / DAY_MS);

const labelOf = (thread: RecentThread, viewer: ViewerDay): DayGroupLabel => {
  if (thread.touched || thread.updatedAt === null) return "Today";
  const days = daysBetween(
    viewer.today,
    dayKey(new Date(thread.updatedAt), viewer.timeZone),
  );
  if (days <= 0) return "Today";
  return days <= WEEK_DAYS ? "This week" : "Earlier";
};

/**
 * The merged list (`mergeRecentThreads`) in its groups, each kept in list
 * order, which is most recent first with this tab's threads leading. Empty
 * groups are left out.
 */
export const groupByDay = (
  threads: readonly RecentThread[],
  viewer: ViewerDay,
): readonly DayGroup[] =>
  ORDER.map((label) => ({
    label,
    threads: threads.filter((thread) => labelOf(thread, viewer) === label),
  })).filter((group) => group.threads.length > 0);
