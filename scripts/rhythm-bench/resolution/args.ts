/** Command-line arguments of `bun run rhythm-bench:resolution` (#290). Pure. */
import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";

export type ResolutionArgs = Readonly<{
  out: string;
  subjects: number;
  afdb: string | null;
  ltafdb: string | null;
  resamples: number;
  bootstrapSeed: number;
}>;

export const DEFAULT_SUBJECTS = 40;
export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_BOOTSTRAP_SEED = 290;

export const USAGE = `usage: bun run rhythm-bench:resolution -- --out ${RHYTHM_BENCH_DIR}/resolution-<run> [--subjects N] [--afdb <dir>] [--ltafdb <dir>] [--resamples N] [--bootstrap-seed N]`;

const KNOWN = new Set([
  "--out",
  "--subjects",
  "--afdb",
  "--ltafdb",
  "--resamples",
  "--bootstrap-seed",
]);

const valueOf = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${name} needs a value\n${USAGE}`);
  return value;
};

const integer = (
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

/** Throws with the usage line on an unknown option or a bad value. */
export const parseArgs = (argv: readonly string[]): ResolutionArgs => {
  const unknown = argv.find((arg) => arg.startsWith("--") && !KNOWN.has(arg));
  if (unknown !== undefined) throw new Error(`unknown option ${unknown}\n${USAGE}`);
  const out = valueOf(argv, "--out");
  if (out === undefined) throw new Error(`--out is required\n${USAGE}`);
  return {
    out,
    subjects: integer(valueOf(argv, "--subjects"), "--subjects", DEFAULT_SUBJECTS, 2),
    afdb: valueOf(argv, "--afdb") ?? null,
    ltafdb: valueOf(argv, "--ltafdb") ?? null,
    resamples: integer(valueOf(argv, "--resamples"), "--resamples", DEFAULT_RESAMPLES, 0),
    bootstrapSeed: integer(
      valueOf(argv, "--bootstrap-seed"),
      "--bootstrap-seed",
      DEFAULT_BOOTSTRAP_SEED,
      0,
    ),
  };
};
