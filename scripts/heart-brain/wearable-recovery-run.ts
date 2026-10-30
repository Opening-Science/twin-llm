/**
 * Host CLI: wearable recovery around condition onsets (#262).
 *
 *   bun run heart-brain:wearables -- --batches 001-003
 *
 * Streams the batch archives read-only (as `bun run heart-brain` does), and
 * for each living subject with an AF, heart failure, stroke or sleep apnea
 * onset (or hypertension and none of these, the control) builds the v3
 * synthetic series over 90 days on each side of the onset, in memory, with
 * the generator's own functions and the batch seed. Writes only the pooled
 * table to `<out>/wearable-recovery.json`; no series is kept. Prints counts.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseArgs } from "./args";
import { bundleFacts } from "./person-facts";
import { tarEntries } from "./tar-entries";
import {
  type Group,
  recoveryTable,
  recoveryWindow,
  type SubjectRow,
  subjectGroups,
  subjectRows,
} from "./wearable-recovery";
import { syntheaPatientOf } from "../synthetic-wearables/bundle";
import { syntheaConditionsOf } from "../synthetic-wearables/conditions";
import { generateSeries } from "../synthetic-wearables/series";

/** Subjects per group and batch, so hypertension does not swamp the run. */
const CAP_PER_BATCH = 400;

const main = async (argv: readonly string[]): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return parsed.startsWith("Usage") ? 0 : 2;
  }
  const archives = resolve(parsed.archives);
  const rows: SubjectRow[] = [];
  const subjects = new Map<Group, number>();
  const seeds: Record<string, number> = {};
  for (const batch of parsed.batches) {
    const manifest = JSON.parse(
      await readFile(join(archives, `batch-${batch}.manifest.json`), "utf8"),
    ) as { seed?: number };
    const seed = manifest.seed ?? parsed.seed;
    seeds[batch] = seed;
    const perBatch = new Map<Group, number>();
    const child = spawn("zstd", ["-dc", join(archives, `batch-${batch}.tar.zst`)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const decoder = new TextDecoder();
    let bundles = 0;
    for await (const entry of tarEntries(child.stdout)) {
      if (!entry.name.endsWith(".json")) continue;
      bundles += 1;
      let bundle: unknown;
      try {
        bundle = JSON.parse(decoder.decode(entry.bytes));
      } catch {
        continue;
      }
      const patient = syntheaPatientOf(bundle);
      if (patient === null || patient.deceased) continue;
      const conditions = syntheaConditionsOf(bundle);
      const hypertension = bundleFacts(bundle, batch)?.person.onsets.hypertension ?? null;
      for (const { group, onset } of subjectGroups(conditions, hypertension)) {
        if ((perBatch.get(group) ?? 0) >= CAP_PER_BATCH) continue;
        perBatch.set(group, (perBatch.get(group) ?? 0) + 1);
        const window = recoveryWindow(onset);
        const series = generateSeries({
          seed,
          subjectRef: patient.id,
          endDay: window.endDay,
          days: window.days,
          conditions,
        });
        rows.push(
          ...subjectRows({
            group,
            onset,
            key: `${seed}:${patient.id}`,
            conditions,
            series,
          }),
        );
      }
    }
    for (const [group, count] of perBatch)
      subjects.set(group, (subjects.get(group) ?? 0) + count);
    process.stdout.write(
      `batch ${batch}: ${bundles} bundles; ${[...perBatch].map(([g, n]) => `${g} ${n}`).join(", ")}\n`,
    );
  }
  const table = recoveryTable(rows);
  const target = join(resolve(parsed.out), "wearable-recovery.json");
  await writeFile(
    target,
    `${JSON.stringify(
      {
        batches: parsed.batches,
        seeds,
        capPerBatch: CAP_PER_BATCH,
        subjects: Object.fromEntries(subjects),
        table,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`wrote ${target}\n`);
  return 0;
};

if ((import.meta as { main?: boolean }).main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
