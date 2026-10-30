/**
 * Builds `evaluation/cohort-codes.v1.json` from the pinned cohort's files:
 *
 *   bun run eval:cohort-codes -- --in .synthea
 *
 * reads `<in>/manifest.json`, `<in>/fhir/*.json` and `<in>/wearables/*.json`
 * and refuses a cohort whose `contentSha256` is not the answer key's.
 *
 * The list is every LOINC-shaped code of a numeric observation the warehouse
 * would store (`mapObservations`, as ingest maps it), in the Synthea bundles
 * and in the synthetic wearable series. The series' own local codes
 * (`hrv-rmssd`, `sleep-score`, …) are left out: a tool's `loinc` argument
 * cannot name them. `cohortCodesFrom` is pure; the CLI reads and writes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { mapObservations } from "../../packages/warehouse/map-observation";

import { COHORT_CODES_PATH, type CohortCodes, LOINC_SHAPE } from "./cohort-codes";
import { loadCohortBundles } from "./cohort-ports";
import { ANSWER_KEY_PATH } from "./eval-results";
import { answerKeySchema, COHORT_ID } from "./question-set";

const entriesOf = (bundle: unknown): readonly unknown[] => {
  const entries: unknown = Reflect.get(Object(bundle), "entry");
  return Array.isArray(entries) ? entries : [];
};

/** Sorted, distinct codes of every numeric observation in the bundles. */
export const cohortCodesFrom = (bundles: readonly unknown[]): readonly string[] =>
  [
    ...new Set(
      bundles.flatMap((bundle) =>
        entriesOf(bundle).flatMap((entry) =>
          mapObservations(Reflect.get(Object(entry), "resource")).flatMap((item) =>
            item.kind === "numeric" && LOINC_SHAPE.test(item.row.loinc)
              ? [item.row.loinc]
              : [],
          ),
        ),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const wearablesManifestSchema = z.object({
  generatorVersion: z.string(),
  cohortId: z.literal(COHORT_ID),
  seed: z.number().int(),
  endDay: z.iso.date(),
  days: z.number().int().positive(),
});

const syntheaManifestSchema = z.object({
  cohortId: z.literal(COHORT_ID),
  contentSha256: z.string(),
});

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

const main = async (argv: readonly string[]): Promise<number> => {
  const args = argv.filter((arg) => arg !== "--");
  const flag = args.indexOf("--in");
  const dir = flag === -1 ? undefined : args[flag + 1];
  if (dir === undefined) {
    process.stderr.write("bun run eval:cohort-codes -- --in <synthea dir>\n");
    return 1;
  }
  const synthea = syntheaManifestSchema.parse(await readJson(join(dir, "manifest.json")));
  const key = answerKeySchema.parse(await readJson(ANSWER_KEY_PATH));
  if (synthea.contentSha256 !== key.cohort.content_sha256) {
    process.stderr.write(
      "COHORT_MISMATCH: the patient files are not the cohort the answer key pins\n",
    );
    return 1;
  }
  const wearables = wearablesManifestSchema.parse(
    await readJson(join(dir, "wearables", "manifest.json")),
  );
  const bundles = [
    ...(await loadCohortBundles(join(dir, "fhir"))),
    ...(await loadCohortBundles(join(dir, "wearables"))),
  ];
  const file: CohortCodes = {
    schema_version: "twin-llm.eval.cohort-codes.v1",
    cohort_id: COHORT_ID,
    content_sha256: synthea.contentSha256,
    wearables: {
      generator_version: wearables.generatorVersion,
      seed: wearables.seed,
      end_day: wearables.endDay,
      days: wearables.days,
    },
    codes: [...cohortCodesFrom(bundles)],
  };
  await writeFile(COHORT_CODES_PATH, `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(`Wrote ${COHORT_CODES_PATH} (${file.codes.length} codes)\n`);
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
