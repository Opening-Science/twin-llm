import { type KioskBeat } from "./beat-focus";

/**
 * A day's beats as rows: a run of three or more steady measured readings
 * with the same event, one after another, folds into one row; every other
 * beat is its own row. Only grouping: each beat is still there, by its index
 * in `day.beats`, and the run's lines give the lowest and highest value of
 * each signal as the beat lines round them. Glucose goes by its specimen,
 * so blood and sensor glucose are never put in one line.
 */

export const MIN_RUN = 3;

export type RunLine = Readonly<{
  /** The signal as the beat line names it: "Heart rate", "Blood glucose", "Sensor glucose". */
  name: string;
  from: string;
  to: string;
  low: number;
  high: number;
  unit: string;
}>;

export type BeatRow =
  | Readonly<{ kind: "beat"; index: number }>
  | Readonly<{ kind: "run"; first: number; last: number; lines: readonly RunLine[] }>;

const quiet = (beat: KioskBeat): boolean =>
  beat.source === "measured" &&
  beat.direction === "steady" &&
  !beat.worth_a_look &&
  beat.value !== null &&
  beat.unit !== null &&
  beat.measure !== "insulin";

/** The signal's name: heart rate, or glucose by its specimen, so blood and sensor never share a line. */
const signalName = (beat: KioskBeat): string =>
  beat.measure === "heart_rate"
    ? "Heart rate"
    : beat.specimen === "sensor"
      ? "Sensor glucose"
      : "Blood glucose";

const runLines = (beats: readonly KioskBeat[]): readonly RunLine[] =>
  beats.reduce<RunLine[]>((lines, beat) => {
    if (beat.value === null || beat.unit === null || beat.measure === "insulin") {
      return lines;
    }
    const value = Math.round(beat.value);
    const name = signalName(beat);
    const at = lines.findIndex((line) => line.name === name);
    if (at < 0) {
      return [
        ...lines,
        {
          name,
          from: beat.time,
          to: beat.time,
          low: value,
          high: value,
          unit: beat.unit,
        },
      ];
    }
    const line = lines[at]!;
    return lines.map((one, index) =>
      index === at
        ? {
            ...line,
            to: beat.time,
            low: Math.min(line.low, value),
            high: Math.max(line.high, value),
          }
        : one,
    );
  }, []);

/** Consecutive indices that belong together: a quiet run of one event, or a single beat. */
const spans = (beats: readonly KioskBeat[]): readonly (readonly number[])[] =>
  beats.reduce<number[][]>((groups, beat, index) => {
    const group = groups.at(-1);
    const previous = group === undefined ? undefined : beats[group.at(-1)!];
    if (
      group !== undefined &&
      previous !== undefined &&
      quiet(beat) &&
      quiet(previous) &&
      previous.event === beat.event
    ) {
      group.push(index);
      return groups;
    }
    return [...groups, [index]];
  }, []);

export const beatRows = (beats: readonly KioskBeat[]): readonly BeatRow[] =>
  spans(beats).flatMap((group): BeatRow[] =>
    group.length >= MIN_RUN
      ? [
          {
            kind: "run",
            first: group[0]!,
            last: group.at(-1)!,
            lines: runLines(group.map((index) => beats[index]!)),
          },
        ]
      : group.map((index) => ({ kind: "beat", index })),
  );
