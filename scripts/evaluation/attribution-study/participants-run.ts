/**
 * Host CLI for Part B's analysis (P6, #508).
 *
 *   bun run attribution:partb -- --simulate [--seed 6511] [--out <dir>]
 *   bun run attribution:partb -- --responses <participants.json> --pilot-median <seconds> [--out <dir>]
 *
 * Writes `partb.md` (exclusions, per-arm counts, U1 and U2 with Holm). With
 * --simulate the participants are made up by `simulateParticipants`, for
 * running the analysis before any real data exist; the page says so. No
 * response file is read in simulation, and nothing is sent anywhere.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_W1_OUT_ROOT } from "../../synthetic-wearables/w1";
import {
  type Participant,
  partB,
  partBMarkdown,
  simulateParticipants,
  SIMULATION_DEFAULTS,
} from "./participants";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const DEFAULT_PART_B_SEED = 6511;
/** The simulation's own pilot median, matching its completion times. */
export const SIMULATED_PILOT_MEDIAN = 900;

export type PartBIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runPartB = async (
  argv: readonly string[],
  io: PartBIo,
  readText: (path: string) => Promise<string>,
  writeText: (path: string, text: string) => Promise<void>,
): Promise<number> => {
  const out = flag(argv, "--out") ?? join(DEFAULT_W1_OUT_ROOT, "part-b");
  if (argv.includes("--simulate")) {
    const seed = Number(flag(argv, "--seed") ?? DEFAULT_PART_B_SEED);
    if (!Number.isInteger(seed) || seed < 0) {
      io.stderr.write("--seed must be a whole number.\n");
      return 1;
    }
    const result = partB(simulateParticipants(seed), SIMULATED_PILOT_MEDIAN);
    const note = `Simulated participants (seed ${seed}, ${SIMULATION_DEFAULTS.perArm} per arm, effects set in the simulation): a check of the analysis, not a result.`;
    await writeText(join(out, "partb.md"), partBMarkdown(result, note));
    io.stdout.write(`Simulated Part B written to ${out}\n`);
    return 0;
  }
  const responses = flag(argv, "--responses");
  const median = Number(flag(argv, "--pilot-median"));
  if (responses === undefined || !Number.isFinite(median) || median <= 0) {
    io.stderr.write(
      "--responses <participants.json> and --pilot-median <seconds> are required, or --simulate.\n",
    );
    return 1;
  }
  const participants = JSON.parse(await readText(responses)) as readonly Participant[];
  const result = partB(participants, median);
  await writeText(
    join(out, "partb.md"),
    partBMarkdown(result, `Responses from ${responses}; pilot median ${median} s.`),
  );
  io.stdout.write(`Part B written to ${out}\n`);
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  process.exit(
    await runPartB(
      process.argv.slice(2),
      process,
      (path) => readFile(resolve(path), "utf8"),
      async (path, text) => {
        const target = resolve(path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, text);
      },
    ),
  );
}
