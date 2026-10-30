import type { z } from "zod";

import {
  GENOME_NOT_PERMITTED,
  type GenomePermitDecision,
  type GenomeRefusalReason,
} from "@/infrastructure/data-mode-policy";
import type { AppendInput } from "@/packages/audit/append";
import type { ImportKind } from "@/packages/personal-data/types";

import { GENOME_VARIANTS_AUDIT_TOOL } from "./imported-names";
import {
  chromSpellings,
  genotypeBases,
  MAX_VARIANT_NAMES,
  MAX_VARIANT_RECORDS,
  parseVariantNames,
  recordMatches,
  type VariantName,
  type VariantRecord,
} from "./imported-variant-names";
import type { genomeVariantsInput } from "./imported-variants-schema";
import type { SessionScope } from "./scope";

/**
 * `genome_variants` (#307): named variants from a person's own imported VCF
 * (`personal_variants`, #180).
 *
 * - Every call asks `permit` first, the genome policy (`permitGenomeRequest`):
 *   personal mode and a chat model on this machine. Anything else is refused
 *   before a read. Over MCP it always refuses.
 * - Lookups by name only: an rsID or one `chrN:pos`, at most 50. No range, no
 *   gene, no "all variants", so the file is never scanned for the model.
 * - Reads go through `GenomeVariantPorts`, bound to one person.
 * - Every call, refusal and throw writes one audit row with counts only: how
 *   many names were asked and how many were found. Never a name, position,
 *   genotype or dataset name, nor a hash of one.
 */

export type GenomeDatasetRecord = Readonly<{
  id: string;
  kind: ImportKind;
  name: string;
  rowCount: number;
}>;

/** Records matching any of these rsIDs or sites in one dataset, at most `take`. */
export type GenomeVariantQuery = Readonly<{
  datasetId: string;
  rsids: readonly string[];
  /** Each site with every spelling of its chromosome (`chr1`, `1`). */
  sites: readonly Readonly<{ chroms: readonly string[]; pos: number }>[];
  take: number;
}>;

export type GenomeVariantPorts = Readonly<{
  /** The person's datasets of every kind, newest first. */
  listDatasets: () => Promise<readonly GenomeDatasetRecord[]>;
  findVariants: (query: GenomeVariantQuery) => Promise<readonly VariantRecord[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export type GenomeVariantsDeps = Readonly<{
  scope: SessionScope;
  /** Asked before every call; the chat route passes the live genome policy. */
  permit: () => GenomePermitDecision;
  ports: GenomeVariantPorts;
}>;

export type GenomeVariantsRefusal = Readonly<{ code: string; error: string }> &
  Readonly<Record<string, unknown>>;

const NOT_PERMITTED_ERRORS: Readonly<Record<GenomeRefusalReason, string>> = {
  "data-mode-not-personal": "genome data is read only in personal data mode",
  "genome-source-not-ark": "genome data is read only when GENOME_SOURCE=ark",
  "chat-model-not-local":
    "genome data is read only by a model on this machine (Ollama on loopback), so nothing was read",
  "carbon-x-not-local": "genome data is read only when Carbon-X runs on this machine",
};

export const genomeVariantsNotPermitted = (
  reason: GenomeRefusalReason,
): GenomeVariantsRefusal => ({
  code: GENOME_NOT_PERMITTED,
  error: NOT_PERMITTED_ERRORS[reason],
  reason,
});

const tooManyNames = (requested: number): GenomeVariantsRefusal => ({
  code: "TOO_MANY_VARIANTS",
  error: `at most ${MAX_VARIANT_NAMES} names per call; ask for fewer`,
  requested,
  max: MAX_VARIANT_NAMES,
});

/** Names echoed back in a refusal; the rest are only counted. */
const MALFORMED_LISTED = 10;

const malformedNames = (malformed: readonly string[]): GenomeVariantsRefusal => ({
  code: "MALFORMED_VARIANT_NAMES",
  error:
    "each name must be an rsID such as rs4244285 or a GRCh38 site written chrN:pos such as chr10:94781859; nothing was read",
  malformed: malformed.slice(0, MALFORMED_LISTED),
  n_malformed: malformed.length,
});

const notFound = (
  datasetId: string,
  vcfs: readonly GenomeDatasetRecord[],
): GenomeVariantsRefusal => ({
  code: "DATASET_NOT_FOUND",
  error:
    vcfs.length === 0
      ? "this person has imported no VCF; one is imported on Customize · Data"
      : "no imported VCF of this person has this id; use one of vcf_datasets",
  dataset_id: datasetId,
  vcf_datasets: vcfs.map((dataset) => ({
    dataset_id: dataset.id,
    name: dataset.name,
    variants: dataset.rowCount,
  })),
});

const notAVcf = (datasetId: string, kind: ImportKind): GenomeVariantsRefusal => ({
  code: "NOT_A_VCF_DATASET",
  error: "this dataset is not an imported VCF, so it holds no variants",
  dataset_id: datasetId,
  kind,
});

const tooManyRecords: GenomeVariantsRefusal = {
  code: "ROW_CAP_EXCEEDED",
  error: `more than ${MAX_VARIANT_RECORDS} records match these names; ask for fewer`,
};

export type GenomeVariantHit = Readonly<{
  chrom: string;
  pos: number;
  id: string | null;
  ref: string;
  alt: string;
  /** GT as the file wrote it (`0/1`), null for a no-call. */
  genotype: string | null;
  /** The same GT in bases (`C/T`), null for a no-call. */
  alleles: string | null;
  filter: string | null;
}>;

export type GenomeVariantLookup = Readonly<{
  name: string;
  found: boolean;
  records: readonly GenomeVariantHit[];
}>;

export type GenomeVariantsResult = Readonly<{
  dataset_id: string;
  build: "GRCh38";
  variants: readonly GenomeVariantLookup[];
  n_requested: number;
  n_found: number;
  note: string;
}>;

export const GENOME_VARIANTS_NOTE =
  "Positions are GRCh38, 1-based, as the file wrote them. Not found means the file has no record for that name; it does not mean the reference allele, since many VCFs list only sites that differ from it. Research use only, not clinical advice.";

/** Audit `result` for a call that threw: a fixed name, never the message. */
export const GENOME_VARIANTS_FAILED = { error: "genome-variants-failed" } as const;

const toHit = (record: VariantRecord): GenomeVariantHit => ({
  chrom: record.chrom,
  pos: record.pos,
  id: record.variantId,
  ref: record.ref,
  alt: record.alt,
  genotype: record.genotype,
  alleles: genotypeBases(record),
  filter: record.filter,
});

/** For each name, the stored records it names, by chromosome, position and ALT. Pure. */
export const lookupNames = (
  names: readonly VariantName[],
  records: readonly VariantRecord[],
): readonly GenomeVariantLookup[] => {
  const ordered = [...records].sort(
    (a, b) =>
      a.chrom.localeCompare(b.chrom) || a.pos - b.pos || a.alt.localeCompare(b.alt),
  );
  return names.map((name) => {
    const hits = ordered.filter((record) => recordMatches(name, record)).map(toHit);
    return { name: name.name, found: hits.length > 0, records: hits };
  });
};

/** The stored-row query for these names. Pure. */
export const variantQuery = (
  datasetId: string,
  names: readonly VariantName[],
): GenomeVariantQuery => ({
  datasetId,
  rsids: names.flatMap((name) => (name.kind === "rsid" ? [name.rsid] : [])),
  sites: names.flatMap((name) =>
    name.kind === "site" ? [{ chroms: chromSpellings(name.chrom), pos: name.pos }] : [],
  ),
  take: MAX_VARIANT_RECORDS + 1,
});

type Outcome = GenomeVariantsResult | GenomeVariantsRefusal;

const isRefusal = (outcome: Outcome): outcome is GenomeVariantsRefusal =>
  "code" in outcome;

const lookUp = async (
  deps: GenomeVariantsDeps,
  input: z.infer<typeof genomeVariantsInput>,
): Promise<Outcome> => {
  const decision = deps.permit();
  if (!decision.ok) return genomeVariantsNotPermitted(decision.reason);
  if (deps.scope.mode !== "personal") {
    return genomeVariantsNotPermitted("data-mode-not-personal");
  }
  if (input.variants.length > MAX_VARIANT_NAMES) {
    return tooManyNames(input.variants.length);
  }
  const parsed = parseVariantNames(input.variants);
  if (parsed.malformed.length > 0) return malformedNames(parsed.malformed);

  const datasets = await deps.ports.listDatasets();
  const dataset = datasets.find((each) => each.id === input.dataset_id);
  if (dataset === undefined) {
    return notFound(
      input.dataset_id,
      datasets.filter((each) => each.kind === "vcf"),
    );
  }
  if (dataset.kind !== "vcf") return notAVcf(dataset.id, dataset.kind);

  const records = await deps.ports.findVariants(variantQuery(dataset.id, parsed.names));
  if (records.length > MAX_VARIANT_RECORDS) return tooManyRecords;
  const variants = lookupNames(parsed.names, records);
  return {
    dataset_id: dataset.id,
    build: "GRCh38",
    variants,
    n_requested: variants.length,
    n_found: variants.filter((each) => each.found).length,
    note: GENOME_VARIANTS_NOTE,
  };
};

/** Run `genome_variants`, with one audit row of counts whatever happens. */
export const runGenomeVariants = async (
  deps: GenomeVariantsDeps,
  input: z.infer<typeof genomeVariantsInput>,
): Promise<Outcome> => {
  const append = (result: Readonly<Record<string, string | number>>, rowCount: number) =>
    deps.ports.appendAudit({
      actor: deps.scope.actor,
      sessionId: deps.scope.sessionId,
      subjectRef: null,
      tool: GENOME_VARIANTS_AUDIT_TOOL,
      args: { requested: input.variants.length },
      result,
      rowCount,
    });
  const outcome = await lookUp(deps, input).catch(async (error: unknown) => {
    await append(GENOME_VARIANTS_FAILED, 0);
    throw error;
  });
  if (isRefusal(outcome)) {
    await append({ code: outcome.code }, 0);
  } else {
    await append({ found: outcome.n_found }, outcome.n_found);
  }
  return outcome;
};
