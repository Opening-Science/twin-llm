/**
 * Axis and tooltip arithmetic for the Data page's charts. Pure, so the tests
 * pin the numbers and the charts stay thin components.
 *
 * The charts draw at their real pixel width (measured), not a fixed viewBox
 * scaled down, so axis text stays readable on a phone.
 */

/** A step of 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
const niceStep = (raw: number): number => {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((step) => step >= raw)!;
};

/**
 * About `count` evenly spaced round ticks covering [min, max], starting at or
 * below `min` and ending at or above `max`. A flat range gets a band around
 * its one value so the line is not drawn on the frame.
 */
export const niceTicks = (min: number, max: number, count = 4): readonly number[] => {
  const low = min === max ? min - Math.max(1, Math.abs(min) * 0.1) : min;
  const high = min === max ? max + Math.max(1, Math.abs(max) * 0.1) : max;
  const step = niceStep((high - low) / count);
  const first = Math.floor(low / step) * step;
  const last = Math.ceil(high / step) * step;
  const n = Math.round((last - first) / step);
  // Multiply rather than add, so 0.1 + 0.2 never drifts into a tick label.
  return Array.from({ length: n + 1 }, (_, i) =>
    Number((first + i * step).toPrecision(12)),
  );
};

/** Ticks from zero for counts, whole steps only (at least 0 to 4). */
export const countTicks = (max: number, count = 4): readonly number[] => {
  const top = Math.max(count, max);
  const raw = niceStep(top / count);
  // 2.5 is a round step for a measurement, not for a count of people.
  const step = Number.isInteger(raw) ? raw : Math.ceil(raw);
  return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
};

/** Decimals a tick label needs for its step (0 for whole steps). */
export const tickDecimals = (ticks: readonly number[]): number => {
  if (ticks.length < 2) return 0;
  const step = Math.abs(ticks[1]! - ticks[0]!);
  return step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
};

/** The index of the value nearest `target` (first one on a tie); -1 when empty. */
export const nearestIndex = (values: readonly number[], target: number): number =>
  values.reduce(
    (best, value, index) =>
      best === -1 || Math.abs(value - target) < Math.abs(values[best]! - target)
        ? index
        : best,
    -1,
  );

/** Every `step`-th index, always including the last, so labels never collide. */
export const labelIndexes = (count: number, maxLabels: number): readonly number[] => {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / Math.max(1, maxLabels)));
  const picked = Array.from({ length: count }, (_, i) => i).filter((i) => i % step === 0);
  const last = count - 1;
  // Drop a label that would sit right beside the last one.
  const trimmed = picked.filter((i) => i === last || last - i >= step);
  return trimmed.includes(last) ? trimmed : [...trimmed, last];
};

/** A label cut to `max` characters with an ellipsis. */
export const truncateLabel = (label: string, max: number): string =>
  label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;

/**
 * 1 January of every year inside [start, end], so a year label sits where that
 * year begins; a span inside one year gets its start instead.
 */
export const yearTickTimes = (start: number, end: number): readonly number[] => {
  const first = new Date(start).getUTCFullYear();
  const last = new Date(end).getUTCFullYear();
  const inside = Array.from({ length: last - first + 1 }, (_, i) =>
    Date.UTC(first + i, 0, 1),
  ).filter((time) => time >= start && time <= end);
  return inside.length > 0 ? inside : [start];
};

/** [min, max] by reduce, so a long series never hits the argument-count limit. */
export const extent = (values: readonly number[]): readonly [number, number] =>
  values.reduce<[number, number]>(
    ([low, high], value) => [Math.min(low, value), Math.max(high, value)],
    [Infinity, -Infinity],
  );

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DAY_MS = 86_400_000;

export type TimeTick = Readonly<{ time: number; label: string }>;

/** Month starts inside [start, end], every `step` months, UTC. */
const monthStarts = (start: number, end: number, step: number): readonly number[] => {
  const from = new Date(start);
  const first = from.getUTCFullYear() * 12 + from.getUTCMonth();
  const last = new Date(end).getUTCFullYear() * 12 + new Date(end).getUTCMonth();
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
    .filter((month) => month % step === 0)
    .map((month) => Date.UTC(Math.floor(month / 12), month % 12, 1))
    .filter((time) => time >= start && time <= end);
};

/**
 * Ticks for a calendar axis that always says where in time it is. Over about
 * two years: one per January, labelled with the year ("2018"). Over about
 * eleven months: quarter starts with month and year ("Mar 2021"). Shorter:
 * a handful of UTC midnights as day and month ("3 Nov").
 */
export const dateAxisTicks = (start: number, end: number): readonly TimeTick[] => {
  const span = end - start;
  if (span > 730 * DAY_MS) {
    return yearTickTimes(start, end).map((time) => ({
      time,
      label: String(new Date(time).getUTCFullYear()),
    }));
  }
  if (span > 335 * DAY_MS) {
    return monthStarts(start, end, 3).map((time) => {
      const date = new Date(time);
      return {
        time,
        label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      };
    });
  }
  const days = Math.max(1, Math.floor(span / DAY_MS));
  const step = Math.max(1, Math.ceil(days / 5)) * DAY_MS;
  const first = Math.ceil(start / DAY_MS) * DAY_MS;
  const count = Math.max(0, Math.floor((end - first) / step) + 1);
  const times = Array.from({ length: count }, (_, i) => first + i * step);
  return (times.length > 0 ? times : [start]).map((time) => {
    const date = new Date(time);
    return { time, label: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` };
  });
};

/** x for a time: proportional to time inside [start, end]; a zero span centres. */
export const timeScale =
  (start: number, end: number, left: number, width: number) =>
  (time: number): number =>
    end === start ? left + width / 2 : left + ((time - start) / (end - start)) * width;
