import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";

/** Command-line arguments of `bun run rhythm-bench`. Pure. */
export type BenchArgs = Readonly<{
  out: string;
  seeds: number;
  afdb: string | null;
  resamples: number;
  bootstrapSeed: number;
  /** A small grid (60 and 300 s, three rhythms, one AF rate, two noise levels) for a quick look. */
  quick: boolean;
}>;

export const DEFAULT_SEEDS = 20;
export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_BOOTSTRAP_SEED = 249;

export const USAGE = `usage: bun run rhythm-bench -- --out ${RHYTHM_BENCH_DIR}/<run> [--seeds N] [--afdb <dir>] [--resamples N] [--bootstrap-seed N] [--quick] (the Lab reads ${RHYTHM_BENCH_DIR}/*/result.json)`;

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
    "--resamples",
    "--bootstrap-seed",
    "--quick",
  ]);
  const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown option ${unknown[0]}\n${USAGE}`);
  const out = valueOf(argv, "--out");
  if (out === undefined || out.startsWith("--"))
    throw new Error(`--out is required\n${USAGE}`);
  const afdb = valueOf(argv, "--afdb");
  if (afdb !== undefined && afdb.startsWith("--"))
    throw new Error(`--afdb needs a directory\n${USAGE}`);
  return {
    out,
    seeds: positiveInt(valueOf(argv, "--seeds"), "--seeds", DEFAULT_SEEDS, 1),
    afdb: afdb ?? null,
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
  };
};
