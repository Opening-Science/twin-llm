/**
 * Flags of `bun run heart-brain`. Pure: the parsed options, or a plain
 * message saying what is wrong.
 */

export const DEFAULT_ARCHIVES = "../synthea-1m-v2/batches";
export const DEFAULT_OUT = "research-out/heart-brain";
export const DEFAULT_BATCHES = "001";

export type HeartBrainArgs = Readonly<{
  /** Three-digit batch ids, `001` to `100`, in order without repeats. */
  batches: readonly string[];
  archives: string;
  out: string;
  jobs: number;
  seed: number;
  controlsPerExposed: number;
  permutations: number;
  /** Synthea's `exporter.years_of_history` for these batches (10, its default); 0 for none. */
  historyYears: number;
  /** The oracle's AF hazard factor (`heart-brain:oracle` only); 1 for the released jar. */
  afFactor: number;
  /** Extract again even when a batch's people file is already there. */
  fresh: boolean;
}>;

export const USAGE =
  "Usage: bun run heart-brain -- [--batches 001-005] [--archives <dir>] [--out <dir>] [--jobs 2] [--seed 250] [--controls 4] [--permutations 50] [--history-years 10] [--af-factor 1] [--fresh]";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const WHOLE = /^\d+$/;
const FIRST = 1;
const LAST = 100;

export const batchId = (number: number): string => String(number).padStart(3, "0");

/** `001-005`, `3` or `001,004-006` as batch ids; or what is wrong. */
export const parseBatches = (spec: string): readonly string[] | string => {
  const numbers: number[] = [];
  for (const part of spec.split(",")) {
    const [fromText = "", toText = fromText, extra] = part.trim().split("-");
    if (extra !== undefined || !WHOLE.test(fromText) || !WHOLE.test(toText)) {
      return `--batches must look like 001-005 or 001,003 (got: ${spec}).`;
    }
    const from = Number(fromText);
    const to = Number(toText);
    if (from > to) return `--batches range ${part.trim()} runs backwards.`;
    if (from < FIRST || to > LAST) {
      return `--batches are ${batchId(FIRST)} to ${batchId(LAST)} (got: ${part.trim()}).`;
    }
    numbers.push(...Array.from({ length: to - from + 1 }, (_, index) => from + index));
  }
  return [...new Set(numbers)].sort((a, b) => a - b).map(batchId);
};

const positive = (
  argv: readonly string[],
  name: string,
  fallback: number,
  min: number,
): number | string => {
  const text = flag(argv, name);
  if (!argv.includes(name)) return fallback;
  if (text === undefined || !WHOLE.test(text) || Number(text) < min) {
    return `${name} must be a whole number from ${min} (got: ${text ?? ""}).`;
  }
  return Number(text);
};

const DECIMAL = /^\d+(\.\d+)?$/;

/** `--af-factor`: a number above 0, 1 when absent; or what is wrong. */
export const parseAfFactor = (argv: readonly string[]): number | string => {
  if (!argv.includes("--af-factor")) return 1;
  const text = flag(argv, "--af-factor") ?? "";
  return DECIMAL.test(text) && Number(text) > 0
    ? Number(text)
    : `--af-factor must be a number above 0 (got: ${text}).`;
};

export const parseArgs = (argv: readonly string[]): HeartBrainArgs | string => {
  if (argv.includes("--help")) return USAGE;
  const batches = parseBatches(flag(argv, "--batches") ?? DEFAULT_BATCHES);
  if (typeof batches === "string") return batches;
  for (const name of ["--archives", "--out"]) {
    const value = flag(argv, name);
    if (argv.includes(name) && (!value || value.startsWith("--"))) {
      return `${name} needs a directory.`;
    }
  }
  const jobs = positive(argv, "--jobs", 2, 1);
  const seed = positive(argv, "--seed", 250, 0);
  const controlsPerExposed = positive(argv, "--controls", 4, 1);
  const permutations = positive(argv, "--permutations", 50, 0);
  const historyYears = positive(argv, "--history-years", 10, 0);
  for (const value of [jobs, seed, controlsPerExposed, permutations, historyYears]) {
    if (typeof value === "string") return value;
  }
  const afFactor = parseAfFactor(argv);
  if (typeof afFactor === "string") return afFactor;
  return {
    batches,
    archives: flag(argv, "--archives") ?? DEFAULT_ARCHIVES,
    out: flag(argv, "--out") ?? DEFAULT_OUT,
    jobs: jobs as number,
    seed: seed as number,
    controlsPerExposed: controlsPerExposed as number,
    permutations: permutations as number,
    historyYears: historyYears as number,
    afFactor,
    fresh: argv.includes("--fresh"),
  };
};
