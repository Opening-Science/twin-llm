import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { GenomePermitDecision } from "@/infrastructure/data-mode-policy";
import type { AppendInput } from "@/packages/audit/append";
import { parseVcf } from "@/packages/personal-data/parse-vcf";
import type { VariantDraft } from "@/packages/personal-data/types";
import { parseCatalog } from "@/scripts/genome-synth/catalog";
import { genomeFor } from "@/scripts/genome-synth/generate";

import { MAX_VARIANT_RECORDS, type VariantRecord } from "./imported-variant-names";
import {
  GENOME_VARIANTS_FAILED,
  GENOME_VARIANTS_NOTE,
  type GenomeDatasetRecord,
  type GenomeVariantQuery,
  type GenomeVariantsDeps,
  lookupNames,
  runGenomeVariants,
  variantQuery,
} from "./imported-variants";
import type { SessionScope } from "./scope";

/**
 * Every VCF here is scripts/genome-synth output for a synthetic subject_ref,
 * parsed by the #180 importer, or a made-up line. Never a person's genome.
 */

const catalog = () => {
  const parsed = parseCatalog(
    readFileSync(
      join(import.meta.dir, "../../scripts/genome-synth/variants.tsv"),
      "utf8",
    ),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const variantsOf = (vcf: string): readonly VariantDraft[] => {
  const parsed = parseVcf(new TextEncoder().encode(vcf), { assumeBuild: null });
  if (!parsed.ok || parsed.kind !== "vcf") throw new Error("synthetic VCF not read");
  return parsed.variants;
};

const SYNTH = variantsOf(
  genomeFor("080b069b-5108-46b6-ecef-6aacd3b9ef3f", catalog()).vcf,
);
/** A second synthetic subject, its chromosomes written without `chr`. */
const BARE = variantsOf(
  genomeFor("1f3a5c7e-0000-4000-8000-000000000001", catalog()).vcf.replace(/^chr/gm, ""),
);

type StoredVariant = VariantRecord & Readonly<{ datasetId: string }>;

const stored = (datasetId: string, rows: readonly VariantDraft[]): StoredVariant[] =>
  rows.map((row) => ({ ...row, datasetId }));

/** A made-up record whose ID cell carries two rsIDs. */
const TWO_IDS: StoredVariant = {
  datasetId: "ds-vcf",
  chrom: "chr22",
  pos: 1234,
  variantId: "rs900001;rs900002",
  ref: "A",
  alt: "G,T",
  genotype: "1|2",
  filter: null,
};

const VARIANTS: readonly StoredVariant[] = [
  ...stored("ds-vcf", SYNTH),
  TWO_IDS,
  ...stored("ds-bare", BARE),
];

const DATASETS: readonly GenomeDatasetRecord[] = [
  { id: "ds-vcf", kind: "vcf", name: "Synthetic VCF", rowCount: SYNTH.length + 1 },
  { id: "ds-bare", kind: "vcf", name: "Synthetic VCF 2", rowCount: BARE.length },
  { id: "ds-labs", kind: "lab-csv", name: "Made-up labs", rowCount: 4 },
];

const SCOPE: SessionScope = { actor: "user-1", sessionId: "turn-1", mode: "personal" };
const ALLOWED: GenomePermitDecision = { ok: true };

/** In-memory ports with the store's query semantics: whole IDs or `;` parts, either spelling. */
const fakeDeps = (
  options: Readonly<{
    permit?: GenomePermitDecision;
    scope?: SessionScope;
    variants?: readonly StoredVariant[];
    findVariants?: (query: GenomeVariantQuery) => Promise<readonly VariantRecord[]>;
  }> = {},
) => {
  const audits: AppendInput[] = [];
  const queries: GenomeVariantQuery[] = [];
  const rows = options.variants ?? VARIANTS;
  const deps: GenomeVariantsDeps = {
    scope: options.scope ?? SCOPE,
    permit: () => options.permit ?? ALLOWED,
    ports: {
      listDatasets: async () => DATASETS,
      findVariants:
        options.findVariants ??
        (async (query) => {
          queries.push(query);
          return rows
            .filter(
              (row) =>
                row.datasetId === query.datasetId &&
                ((row.variantId !== null &&
                  row.variantId.split(";").some((id) => query.rsids.includes(id))) ||
                  query.sites.some(
                    (site) => site.chroms.includes(row.chrom) && site.pos === row.pos,
                  )),
            )
            .slice(0, query.take)
            .map(({ datasetId: _datasetId, ...record }) => record);
        }),
      appendAudit: async (input) => {
        audits.push(input);
      },
    },
  };
  return { deps, audits, queries };
};

const auditOf = (audits: readonly AppendInput[]) =>
  audits.map((row) => [row.tool, row.args, row.result, row.rowCount, row.subjectRef]);

describe("genome_variants on a genome-synth VCF", () => {
  test("named rsIDs and a site: found or not, as the file wrote them", async () => {
    const { deps, audits } = fakeDeps();
    const result = await runGenomeVariants(deps, {
      dataset_id: "ds-vcf",
      variants: ["rs2297595", "rs1801265", "chr1:230710048", "rs999999999", "chr2:1"],
    });
    expect(result).toEqual({
      dataset_id: "ds-vcf",
      build: "GRCh38",
      variants: [
        {
          name: "rs2297595",
          found: true,
          records: [
            {
              chrom: "chr1",
              pos: 97699535,
              id: "rs2297595",
              ref: "T",
              alt: "C",
              genotype: "0/1",
              alleles: "T/C",
              filter: "PASS",
            },
          ],
        },
        {
          name: "rs1801265",
          found: true,
          records: [
            {
              chrom: "chr1",
              pos: 97883329,
              id: "rs1801265",
              ref: "A",
              alt: "G",
              genotype: "1/1",
              alleles: "G/G",
              filter: "PASS",
            },
          ],
        },
        {
          name: "chr1:230710048",
          found: true,
          records: [
            {
              chrom: "chr1",
              pos: 230710048,
              id: "rs699",
              ref: "A",
              alt: "G",
              genotype: "0/1",
              alleles: "A/G",
              filter: "PASS",
            },
          ],
        },
        { name: "rs999999999", found: false, records: [] },
        { name: "chr2:1", found: false, records: [] },
      ],
      n_requested: 5,
      n_found: 3,
      note: GENOME_VARIANTS_NOTE,
    });
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 5 }, { found: 3 }, 3, null],
    ]);
  });

  test("a site finds a file that writes chromosomes without chr", async () => {
    const { deps, queries } = fakeDeps();
    const result = await runGenomeVariants(deps, {
      dataset_id: "ds-bare",
      variants: ["chr1:230710048"],
    });
    expect(queries).toEqual([
      {
        datasetId: "ds-bare",
        rsids: [],
        sites: [{ chroms: ["chr1", "1"], pos: 230710048 }],
        take: MAX_VARIANT_RECORDS + 1,
      },
    ]);
    if (!("variants" in result)) throw new Error(result.code);
    expect(result.variants.map((each) => [each.name, each.records[0]?.chrom])).toEqual([
      ["chr1:230710048", "1"],
    ]);
  });

  test("an rsID in a cell of two IDs is found; a name asked twice is answered once", async () => {
    const { deps, audits } = fakeDeps();
    const result = await runGenomeVariants(deps, {
      dataset_id: "ds-vcf",
      variants: ["rs900002", "rs900002"],
    });
    if (!("variants" in result)) throw new Error(result.code);
    expect(result.variants).toEqual([
      {
        name: "rs900002",
        found: true,
        records: [
          {
            chrom: "chr22",
            pos: 1234,
            id: "rs900001;rs900002",
            ref: "A",
            alt: "G,T",
            genotype: "1|2",
            alleles: "G|T",
            filter: null,
          },
        ],
      },
    ]);
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 2 }, { found: 1 }, 1, null],
    ]);
  });

  test("never reads another dataset's records", async () => {
    const { deps } = fakeDeps();
    const result = await runGenomeVariants(deps, {
      dataset_id: "ds-vcf",
      variants: ["chr1:1"],
    });
    if (!("variants" in result)) throw new Error(result.code);
    expect(result.n_found).toBe(0);
  });
});

describe("genome_variants refusals", () => {
  test("the genome policy refuses before any read", async () => {
    const { deps, audits, queries } = fakeDeps({
      permit: { ok: false, code: "GENOME_NOT_PERMITTED", reason: "chat-model-not-local" },
    });
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-vcf", variants: ["rs699"] }),
    ).toEqual({
      code: "GENOME_NOT_PERMITTED",
      error:
        "genome data is read only by a model on this machine (Ollama on loopback), so nothing was read",
      reason: "chat-model-not-local",
    });
    expect(queries).toEqual([]);
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 1 }, { code: "GENOME_NOT_PERMITTED" }, 0, null],
    ]);
  });

  test("a synthetic scope is refused even if the policy said yes", async () => {
    const { deps, queries } = fakeDeps({ scope: { ...SCOPE, mode: "synthetic" } });
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-vcf", variants: ["rs699"] }),
    ).toEqual({
      code: "GENOME_NOT_PERMITTED",
      error: "genome data is read only in personal data mode",
      reason: "data-mode-not-personal",
    });
    expect(queries).toEqual([]);
  });

  test("more than 50 names is refused, not cut", async () => {
    const { deps, audits, queries } = fakeDeps();
    const names = Array.from({ length: 51 }, (_, index) => `rs${index + 1}`);
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-vcf", variants: names }),
    ).toEqual({
      code: "TOO_MANY_VARIANTS",
      error: "at most 50 names per call; ask for fewer",
      requested: 51,
      max: 50,
    });
    expect(queries).toEqual([]);
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 51 }, { code: "TOO_MANY_VARIANTS" }, 0, null],
    ]);
  });

  test("a range, a gene or a wildcard is refused before any read", async () => {
    const { deps, queries } = fakeDeps();
    expect(
      await runGenomeVariants(deps, {
        dataset_id: "ds-vcf",
        variants: ["rs699", "chr1:1-249000000", "CYP2C19", "*"],
      }),
    ).toEqual({
      code: "MALFORMED_VARIANT_NAMES",
      error:
        "each name must be an rsID such as rs4244285 or a GRCh38 site written chrN:pos such as chr10:94781859; nothing was read",
      malformed: ["chr1:1-249000000", "CYP2C19", "*"],
      n_malformed: 3,
    });
    expect(queries).toEqual([]);
  });

  test("an unknown dataset lists the person's VCFs", async () => {
    const { deps, audits } = fakeDeps();
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-other", variants: ["rs699"] }),
    ).toEqual({
      code: "DATASET_NOT_FOUND",
      error: "no imported VCF of this person has this id; use one of vcf_datasets",
      dataset_id: "ds-other",
      vcf_datasets: [
        { dataset_id: "ds-vcf", name: "Synthetic VCF", variants: SYNTH.length + 1 },
        { dataset_id: "ds-bare", name: "Synthetic VCF 2", variants: BARE.length },
      ],
    });
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 1 }, { code: "DATASET_NOT_FOUND" }, 0, null],
    ]);
  });

  test("a dataset that is not a VCF is refused as the wrong kind", async () => {
    const { deps, queries } = fakeDeps();
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-labs", variants: ["rs699"] }),
    ).toEqual({
      code: "NOT_A_VCF_DATASET",
      error: "this dataset is not an imported VCF, so it holds no variants",
      dataset_id: "ds-labs",
      kind: "lab-csv",
    });
    expect(queries).toEqual([]);
  });

  test("more records than the cap is refused", async () => {
    const many = Array.from({ length: MAX_VARIANT_RECORDS + 1 }, (_, index) => ({
      ...TWO_IDS,
      alt: `A${index}`,
    }));
    const { deps } = fakeDeps({ findVariants: async () => many });
    expect(
      await runGenomeVariants(deps, { dataset_id: "ds-vcf", variants: ["chr22:1234"] }),
    ).toEqual({
      code: "ROW_CAP_EXCEEDED",
      error: "more than 200 records match these names; ask for fewer",
    });
  });

  test("a failed read writes a fixed audit row and throws", async () => {
    const { deps, audits } = fakeDeps({
      findVariants: async () => {
        throw new Error("database down");
      },
    });
    await expect(
      runGenomeVariants(deps, { dataset_id: "ds-vcf", variants: ["rs699"] }),
    ).rejects.toThrow("database down");
    expect(auditOf(audits)).toEqual([
      ["genome.variants", { requested: 1 }, GENOME_VARIANTS_FAILED, 0, null],
    ]);
  });
});

describe("pure helpers", () => {
  test("variantQuery splits rsIDs from sites and asks for one record over the cap", () => {
    expect(
      variantQuery("ds-vcf", [
        { kind: "rsid", name: "rs699", rsid: "rs699" },
        { kind: "site", name: "chrM:73", chrom: "M", pos: 73 },
      ]),
    ).toEqual({
      datasetId: "ds-vcf",
      rsids: ["rs699"],
      sites: [{ chroms: ["chrM", "chrMT", "M", "MT"], pos: 73 }],
      take: 201,
    });
  });

  test("lookupNames orders a name's records and marks the missing", () => {
    const at = (alt: string): VariantRecord => ({ ...TWO_IDS, alt, genotype: null });
    expect(
      lookupNames(
        [
          { kind: "site", name: "chr22:1234", chrom: "22", pos: 1234 },
          { kind: "rsid", name: "rs5", rsid: "rs5" },
        ],
        [at("T"), at("C")],
      ).map((each) => [each.name, each.found, each.records.map((hit) => hit.alt)]),
    ).toEqual([
      ["chr22:1234", true, ["C", "T"]],
      ["rs5", false, []],
    ]);
  });
});
