/**
 * Maintainer CLI: refresh the public fields of `variants.tsv` from the Ensembl
 * REST API, keeping the curated columns (rsid, category, gene, note).
 *
 *   bun scripts/genome-synth/refresh-catalog.ts            # print what would change
 *   bun scripts/genome-synth/refresh-catalog.ts --write    # rewrite variants.tsv
 *
 * Not part of any test or build: the committed TSV is the source of truth and
 * the generator never goes online. For each rsID it reads the GRCh38 mapping,
 * the reference allele and population frequencies (`/variation/human`, pops=1),
 * the ClinVar significance Ensembl imports, the most severe consequence, the
 * gene symbols VEP reports (`/vep/human/id`, a check against the curated gene)
 * and the reference base at the position (`/sequence/region/human`, a check
 * that the reference allele is the GRCh38 base). The alternate allele is the
 * most frequent non-reference allele in gnomAD genomes, else 1000 Genomes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CATALOG_COLUMNS, renderCatalog, type Variant } from "./catalog";

const ENSEMBL = "https://rest.ensembl.org";
const AF_SOURCES = [
  ["gnomADg:ALL", "gnomADg:ALL"],
  ["1000GENOMES:phase_3:ALL", "1000G-phase3:ALL"],
  ["gnomADe:ALL", "gnomADe:ALL"],
] as const;

type Population = Readonly<{ population: string; allele: string; frequency: number }>;
type Mapping = Readonly<{
  assembly_name: string;
  seq_region_name: string;
  start: number;
  end: number;
  allele_string: string;
}>;
type EnsemblVariant = Readonly<{
  mappings: readonly Mapping[];
  populations?: readonly Population[];
  clinical_significance?: readonly string[];
  most_severe_consequence?: string;
}>;
type VepResult = Readonly<{
  id: string;
  transcript_consequences?: ReadonlyArray<Readonly<{ gene_symbol?: string }>>;
}>;

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${ENSEMBL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
};

const AUTOSOMES = new Set(Array.from({ length: 22 }, (_, index) => String(index + 1)));

const curatedRows = (text: string) =>
  text
    .split("\n")
    .filter(
      (line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("rsid\t"),
    )
    .map((line) => {
      const cells = line.split("\t");
      const at = (name: (typeof CATALOG_COLUMNS)[number]) =>
        cells[CATALOG_COLUMNS.indexOf(name)] ?? "";
      return {
        rsid: at("rsid"),
        category: at("category"),
        gene: at("gene"),
        note: at("note"),
      };
    });

const headerOf = (text: string): string[] =>
  text.split("\n").filter((line) => line.startsWith("#"));

const main = async () => {
  const path = fileURLToPath(new URL("./variants.tsv", import.meta.url));
  const text = await readFile(path, "utf8");
  const curated = curatedRows(text);
  const ids = curated.map((row) => row.rsid);
  const variants = await post<Record<string, EnsemblVariant>>("/variation/human?pops=1", {
    ids,
  });
  const vep = await post<VepResult[]>("/vep/human/id", { ids });
  const genesFor = new Map(
    vep.map((result) => [
      result.id,
      new Set((result.transcript_consequences ?? []).flatMap((t) => t.gene_symbol ?? [])),
    ]),
  );
  const rows: Variant[] = [];
  const problems: string[] = [];
  for (const row of curated) {
    const found = variants[row.rsid];
    const mapping = found?.mappings.find(
      (m) => m.assembly_name === "GRCh38" && AUTOSOMES.has(m.seq_region_name),
    );
    if (!found || !mapping || mapping.start !== mapping.end) {
      problems.push(`${row.rsid}: no single-base autosomal GRCh38 mapping`);
      continue;
    }
    const [ref = "", ...alts] = mapping.allele_string.split("/");
    const frequencyOf = (population: string, allele: string) =>
      found.populations?.find((p) => p.population === population && p.allele === allele)
        ?.frequency;
    const source = AF_SOURCES.find(([population]) =>
      alts.some((allele) => frequencyOf(population, allele) !== undefined),
    );
    if (!source) {
      problems.push(`${row.rsid}: no population frequency`);
      continue;
    }
    const [alt = "", altAf = 0] = alts
      .map((allele) => [allele, frequencyOf(source[0], allele) ?? 0] as const)
      .sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (!/^[ACGT]$/.test(ref) || !/^[ACGT]$/.test(alt)) {
      problems.push(`${row.rsid}: not a single-base substitution (${ref}>${alt})`);
      continue;
    }
    const genes = genesFor.get(row.rsid) ?? new Set<string>();
    if (genes.size > 0 && !genes.has(row.gene)) {
      problems.push(
        `${row.rsid}: curated gene ${row.gene}, VEP has ${[...genes].join(",")}`,
      );
    }
    rows.push({
      rsid: row.rsid,
      category: row.category as Variant["category"],
      gene: row.gene,
      chrom: `chr${mapping.seq_region_name}`,
      pos: mapping.start,
      ref,
      alt,
      // Four significant digits, so a rare allele keeps a non-zero frequency.
      altAf: Number(altAf.toPrecision(4)),
      afSource: source[1],
      consequence: found.most_severe_consequence ?? "",
      clinvar: [...(found.clinical_significance ?? [])].sort().join(";"),
      note: row.note,
    });
  }
  // The region endpoint takes at most 50 regions per request.
  const regionOf = (row: Variant) => `${row.chrom.slice(3)}:${row.pos}..${row.pos}:1`;
  const bases = new Map<string, string>();
  for (let start = 0; start < rows.length; start += 50) {
    const chunk = rows.slice(start, start + 50);
    const sequences = await post<ReadonlyArray<Readonly<{ query: string; seq: string }>>>(
      "/sequence/region/human",
      { regions: chunk.map(regionOf) },
    );
    for (const sequence of sequences)
      bases.set(sequence.query, sequence.seq.toUpperCase());
  }
  for (const row of rows) {
    const base = bases.get(regionOf(row));
    if (base !== row.ref)
      problems.push(`${row.rsid}: reference base ${base}, allele ${row.ref}`);
  }
  const next = renderCatalog(headerOf(text), rows);
  console.log(`${rows.length} variants; ${problems.length} problems`);
  for (const problem of problems) console.log(`  ${problem}`);
  if (next === text) {
    console.log("variants.tsv is up to date.");
  } else if (rows.length < curated.length) {
    console.log("Some rows could not be refreshed; variants.tsv left as it is.");
  } else if (process.argv.includes("--write")) {
    await writeFile(path, next);
    console.log(`wrote ${path}`);
  } else {
    console.log("variants.tsv would change; pass --write to rewrite it.");
  }
};

await main();
