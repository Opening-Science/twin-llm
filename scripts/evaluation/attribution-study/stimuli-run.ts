/**
 * Host CLI: writes the user study's stimuli and a preview page per arm
 * (P6 Part B, #508).
 *
 *   bun run attribution:stimuli
 *   bun run attribution:stimuli -- --seed 6510 --out <dir>
 *
 * `stimuli.json` and `D0.html`, `D1.html`, `D2.html` under
 * `.attribution-study/stimuli-seed<seed>/` (gitignored). Synthetic only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_W1_OUT_ROOT } from "../../synthetic-wearables/w1";
import { ARMS, DEFAULT_STIMULI_SEED, generateStimuli } from "./stimuli";
import { stimulusPage } from "./stimulus-page";

export type StimuliIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runStimuli = async (
  argv: readonly string[],
  io: StimuliIo,
  writeText: (path: string, text: string) => Promise<void>,
): Promise<number> => {
  const index = argv.indexOf("--seed");
  const seed = Number(index === -1 ? DEFAULT_STIMULI_SEED : argv[index + 1]);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) {
    io.stderr.write("--seed must be a whole number.\n");
    return 1;
  }
  const outIndex = argv.indexOf("--out");
  const out =
    outIndex === -1
      ? join(DEFAULT_W1_OUT_ROOT, `stimuli-seed${seed}`)
      : (argv[outIndex + 1] ?? "");
  const set = generateStimuli(seed);
  await writeText(join(out, "stimuli.json"), `${JSON.stringify(set, null, 2)}\n`);
  for (const arm of ARMS)
    await writeText(join(out, `${arm}.html`), stimulusPage(set, arm));
  io.stdout.write(
    `Synthetic stimuli written to ${out}: ${set.trials.length} trials, ${set.panel.length} readings in the panel\n`,
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  process.exit(
    await runStimuli(process.argv.slice(2), process, async (path, text) => {
      const target = resolve(path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, text);
    }),
  );
}
