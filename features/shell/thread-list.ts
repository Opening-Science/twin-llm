import { formatNumber } from "@/infrastructure/format-measure";
import type { TouchedThread } from "@/infrastructure/thread-history-store";

/**
 * The sidebar's thread list without any I/O: the shapes, the recency buckets
 * and how threads this browser just wrote to are folded in before the server
 * has drawn them. Client-safe, so the sidebar and the server loader share it.
 */

export type ThreadSummary = Readonly<{ id: string; title: string; modelCount: number }>;

export type ThreadGroup = Readonly<{ label: string; threads: readonly ThreadSummary[] }>;

export const BUCKETS = ["Today", "This week", "Earlier"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * Today starts at local midnight; "This week" covers the six days before it.
 * Calendar days, not a rolling 24 hours, so a thread from 23:50 yesterday is
 * never "Today".
 */
export const bucketFor = (updatedAt: Date, now: Date): Bucket => {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = updatedAt.getTime();
  if (at >= midnight) return "Today";
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  ).getTime();
  return at >= weekStart ? "This week" : "Earlier";
};

export const modelCountLabel = (count: number): string =>
  `${formatNumber(count, 0)} ${count === 1 ? "model" : "models"}`;

/** Threads already in recency order, split into non-empty buckets in bucket order. */
export const groupThreads = (
  threads: readonly (ThreadSummary & Readonly<{ updatedAt: Date }>)[],
  now: Date,
): ThreadGroup[] =>
  BUCKETS.map((label) => ({
    label,
    threads: threads
      .filter((thread) => bucketFor(thread.updatedAt, now) === label)
      .map(({ id, title, modelCount }) => ({ id, title, modelCount })),
  })).filter((group) => group.threads.length > 0);

/**
 * Puts threads this browser just sent to at the top of "Today", most recent
 * first. Where the server already lists a thread, its entry wins (its model
 * count covers every turn, the browser's only the last one); the browser's
 * note only fills in a thread the server has not drawn yet.
 */
export const withTouchedThreads = (
  groups: readonly ThreadGroup[],
  touched: readonly TouchedThread[],
): readonly ThreadGroup[] => {
  if (touched.length === 0) return groups;

  const known = new Map(
    groups.flatMap((group) => group.threads).map((thread) => [thread.id, thread]),
  );
  const touchedIds = new Set(touched.map((thread) => thread.id));
  const front = touched.map((thread) => known.get(thread.id) ?? thread);
  const rest = groups.map((group) => ({
    label: group.label,
    threads: group.threads.filter((thread) => !touchedIds.has(thread.id)),
  }));
  const today = rest.find((group) => group.label === "Today")?.threads ?? [];

  return [
    { label: "Today", threads: [...front, ...today] },
    ...rest.filter((group) => group.label !== "Today" && group.threads.length > 0),
  ];
};
