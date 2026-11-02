import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";
import { AF_DEPENDENCES, type AfDependence } from "@/packages/rhythm-sim/af-interval";

import { type DatabaseId } from "./databases";

/** Command-line arguments of `bun run rhythm-bench`. Pure. */
export type BenchArgs = Readonly<{
  out: string;
  seeds: number;
  /** The annotated database to read, from `--afdb <dir>` or `--ltafdb <dir>` (one at most). */
  database: Readonly<{ id: DatabaseId; dir: string }> | null;
  resamples: number;
  bootstrapSeed: number;
  /** A small grid (60 and 300 s, three rhythms, one AF rate, two noise levels) for a quick look. */
  quick: boolean;
  /** Apply the grid's beat-detection noise levels to the database beats too (#296). */
  realNoise: boolean;
  /** How simulated AF intervals depend on each other (#297); independent by default. */
  afDependence: AfDependence;
  /** Sampling grid for the simulated intervals, ms (#418); 0, the default, leaves them as simulated. */
  rrGridMs: number;
}>;

export const DEFAULT_SEEDS = 20;
export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_BOOTSTRAP_SEED = 249;

export const USAGE = `usage: bun run rhythm-bench -- --out ${RHYTHM_BENCH_DIR}/<run> [--seeds N] [--afdb <dir> | --ltafdb <dir>] [--resamples N] [--bootstrap-seed N] [--quick] [--real-noise] [--af-dependence independent|short_range] [--rr-grid-ms <ms>] (the Lab reads ${RHYTHM_BENCH_DIR}/*/result.json)`;

const valueOf = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const positiveInt = (
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min)
    throw new Error(`${name} must be an integer of at least ${min}`);
  return value;
};

export const parseArgs = (argv: readonly string[]): BenchArgs => {
  const known = new Set([
    "--out",
    "--seeds",
    "--afdb",
    "--ltafdb",
    "--resamples",
    "--bootstrap-seed",
    "--quick",
    "--real-noise",
    "--af-dependence",
    "--rr-grid-ms",
  ]);
  const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown option ${unknown[0]}\n${USAGE}`);
  const out = valueOf(argv, "--out");
  if (out === undefined || out.startsWith("--"))
    throw new Error(`--out is required\n${USAGE}`);
  const given = (["afdb", "ltafdb"] as const).flatMap((id) => {
    const dir = valueOf(argv, `--${id}`);
    if (dir === undefined && !argv.includes(`--${id}`)) return [];
    if (dir === undefined || dir.startsWith("--"))
      throw new Error(`--${id} needs a directory\n${USAGE}`);
    return [{ id, dir }];
  });
  if (given.length > 1)
    throw new Error(`give one database, --afdb or --ltafdb, per run\n${USAGE}`);
  const realNoise = argv.includes("--real-noise");
  if (realNoise && given.length === 0)
    throw new Error(`--real-noise needs the database (--afdb or --ltafdb)\n${USAGE}`);
  const dependence = valueOf(argv, "--af-dependence");
  const afDependence = AF_DEPENDENCES.find((each) => each === dependence);
  if (argv.includes("--af-dependence") && afDependence === undefined)
    throw new Error(`--af-dependence takes ${AF_DEPENDENCES.join(" or ")}\n${USAGE}`);
  const grid = valueOf(argv, "--rr-grid-ms");
  const rrGridMs = grid === undefined ? 0 : Number(grid);
  if (
    argv.includes("--rr-grid-ms") &&
    (grid === undefined ||
      grid.trim() === "" ||
      !Number.isFinite(rrGridMs) ||
      rrGridMs < 0)
  )
    throw new Error(`--rr-grid-ms takes a number of ms, 0 or more\n${USAGE}`);
  return {
    out,
    seeds: positiveInt(valueOf(argv, "--seeds"), "--seeds", DEFAULT_SEEDS, 1),
    database: given[0] ?? null,
    resamples: positiveInt(
      valueOf(argv, "--resamples"),
      "--resamples",
      DEFAULT_RESAMPLES,
      0,
    ),
    bootstrapSeed: positiveInt(
      valueOf(argv, "--bootstrap-seed"),
      "--bootstrap-seed",
      DEFAULT_BOOTSTRAP_SEED,
      0,
    ),
    quick: argv.includes("--quick"),
    realNoise,
    afDependence: afDependence ?? "independent",
    rrGridMs,
  };
};
