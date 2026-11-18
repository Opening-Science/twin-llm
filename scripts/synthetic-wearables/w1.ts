/**
 * Host CLI: writes item set W1, or its development set, for the
 * source-attribution study (P6, #508).
 *
 *   bun run attribution:w1
 *   bun run attribution:w1 -- --set dev
 *   bun run attribution:w1 -- --seed 6508 --end 2026-10-01 --out <dir>
 *
 * Writes `items.json` (every item with its readings and expected answer) and
 * `manifest.json` (generator, seed, quotas, the assumed error model, counts
 * and the items file's SHA-256, the hash the pre-registration records).
 * Synthetic only: it reads no person's data and has no path to a database.
 * Prints counts only.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { SOURCE_RULES_VERSION } from "../../infrastructure/wearable-source-rules";

import {
  countW1,
  DEV_OPTIONS,
  ERROR_MODEL,
  FIXED_ORDER,
  generateW1,
  MAX_ATTEMPTS,
  W1_DEFAULTS,
  W1_GENERATOR,
  W1_TEST_DATA_NOTE,
  type W1Item,
  type W1Options,
} from "./w1-items";

export const DEFAULT_W1_OUT_ROOT = ".attribution-study";

export type W1Set = "w1" | "dev";

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The two files, by name, as the exact text written. */
export const renderW1 = (
  set: W1Set,
  options: W1Options,
  items: readonly W1Item[],
): ReadonlyMap<string, string> => {
  const itemsText = text({
    testData: true,
    note: W1_TEST_DATA_NOTE,
    generator: W1_GENERATOR,
    set,
    seed: options.seed,
    items,
  });
  const manifest = text({
    testData: true,
    note: W1_TEST_DATA_NOTE,
    generator: W1_GENERATOR,
    rulesVersion: SOURCE_RULES_VERSION,
    set,
    options,
    fixedOrder: FIXED_ORDER,
    maxAttempts: MAX_ATTEMPTS,
    errorModel: { assumed: true, perSourceAndMeasure: ERROR_MODEL },
    counts: countW1(items),
    itemsSha256: createHash("sha256").update(itemsText).digest("hex"),
  });
  return new Map([
    ["items.json", itemsText],
    ["manifest.json", manifest],
  ]);
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type W1Args = Readonly<{ set: W1Set; options: W1Options; output: string }>;

export const parseW1Args = (argv: readonly string[]): W1Args | string => {
  const set = flag(argv, "--set") ?? "w1";
  if (set !== "w1" && set !== "dev") return "--set must be w1 or dev.";
  const base = set === "dev" ? DEV_OPTIONS : W1_DEFAULTS;
  const seed = Number(flag(argv, "--seed") ?? base.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) {
    return "--seed must be a whole number.";
  }
  if (set === "dev" && seed === W1_DEFAULTS.seed) {
    return "The development set never uses the confirmatory seed.";
  }
  const endDay = flag(argv, "--end") ?? base.endDay;
  if (!ISO_DAY.test(endDay) || Number.isNaN(Date.parse(`${endDay}T00:00:00Z`))) {
    return "--end must be a date like 2026-10-01.";
  }
  return {
    set,
    options: { ...base, seed, endDay },
    output: flag(argv, "--out") ?? join(DEFAULT_W1_OUT_ROOT, `${set}-seed${seed}`),
  };
};

export type W1Io = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runW1 = async (
  argv: readonly string[],
  io: W1Io,
  writeText: (path: string, text: string) => Promise<void>,
): Promise<number> => {
  const args = parseW1Args(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const items = generateW1(args.options);
  const files = renderW1(args.set, args.options, items);
  for (const [name, body] of files) await writeText(join(args.output, name), body);
  const counts = countW1(items);
  io.stdout.write(
    [
      `Synthetic test items written to ${args.output} (${W1_GENERATOR}, ${args.set}, seed ${args.options.seed})`,
      `Items: ${items.length} over ${counts.people} people; ${Object.entries(
        counts.byStratum,
      )
        .map(([stratum, count]) => `${stratum} ${count}`)
        .join(", ")}`,
      `Redrawn for identifiability: ${counts.redrawn}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runW1(process.argv.slice(2), process, async (path, body) => {
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  });
  process.exit(code);
}
