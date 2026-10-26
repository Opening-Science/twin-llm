/**
 * Host CLI: a synthetic genome for one or more synthetic subjects.
 *
 *   bun run genome:synth -- --subject 080b069b-5108-46b6-ecef-6aacd3b9ef3f
 *   bun run genome:synth -- --subject <ref>,<ref> --out <dir>
 *
 * Writes `<out>/<ref>.vcf` (VCF 4.2, GRCh38, one sample, every catalog site)
 * and `<out>/<ref>.rsid-genotypes.tsv` (the report the Ark app would print for
 * that VCF). Default out: `data/genome-synth/subjects` (gitignored). Takes
 * UUID-shaped subject_refs only, as Synthea writes them. The same subject_ref
 * and catalog version give the same bytes. Prints counts only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { reportFor } from "./ark-report";
import type { Variant } from "./catalog";
import { type Call, callsFor, CATALOG_VERSION } from "./genotypes";
import { renderVcf } from "./vcf";

export const SUBJECT_REF =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DEFAULT_SUBJECTS_OUT = "data/genome-synth/subjects";

export type GenerateArgs = Readonly<{ subjects: readonly string[]; out: string }>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const parseGenerateArgs = (argv: readonly string[]): GenerateArgs | string => {
  const subjects = (flag(argv, "--subject") ?? "").split(",").filter(Boolean);
  if (subjects.length === 0) {
    return "Usage: bun run genome:synth -- --subject <subject_ref>[,<subject_ref>] [--out <dir>]";
  }
  const bad = subjects.filter((ref) => !SUBJECT_REF.test(ref));
  if (bad.length > 0) return `Not a synthetic subject_ref: ${bad.join(", ")}.`;
  return { subjects, out: flag(argv, "--out") ?? DEFAULT_SUBJECTS_OUT };
};

export type GenomeFiles = Readonly<{
  vcf: string;
  report: string;
  calls: readonly Call[];
}>;

/** The VCF and Ark report for one subject. Pure. */
export const genomeFor = (
  subjectRef: string,
  catalog: readonly Variant[],
): GenomeFiles => {
  const calls = callsFor(subjectRef, catalog);
  return { vcf: renderVcf(subjectRef, calls), report: reportFor(calls, catalog), calls };
};

export const callCounts = (calls: readonly Call[]) => ({
  sites: calls.length,
  homRef: calls.filter((call) => call.altCopies === 0).length,
  het: calls.filter((call) => call.altCopies === 1).length,
  homAlt: calls.filter((call) => call.altCopies === 2).length,
  noCall: calls.filter((call) => call.altCopies === null).length,
});

export type GenerateDeps = Readonly<{
  catalog: () => Promise<readonly Variant[]>;
  writeText: (path: string, text: string) => Promise<void>;
}>;

export const runGenerate = async (
  argv: readonly string[],
  io: Readonly<{
    stdout: { write: (s: string) => void };
    stderr: { write: (s: string) => void };
  }>,
  deps: GenerateDeps,
): Promise<number> => {
  const args = parseGenerateArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const catalog = await deps.catalog();
  for (const subjectRef of args.subjects) {
    const files = genomeFor(subjectRef, catalog);
    await deps.writeText(join(args.out, `${subjectRef}.vcf`), files.vcf);
    await deps.writeText(
      join(args.out, `${subjectRef}.rsid-genotypes.tsv`),
      files.report,
    );
    const counts = callCounts(files.calls);
    io.stdout.write(
      `${subjectRef}: ${counts.sites} sites (${counts.homRef} hom ref, ${counts.het} het, ${counts.homAlt} hom alt, ${counts.noCall} no call)\n`,
    );
  }
  io.stdout.write(`Synthetic genomes (${CATALOG_VERSION}) written to ${args.out}\n`);
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { readCatalog } = await import("./read-catalog");
  const { dirname } = await import("node:path");
  const code = await runGenerate(process.argv.slice(2), process, {
    catalog: () => readCatalog(),
    writeText: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
  });
  process.exit(code);
}
