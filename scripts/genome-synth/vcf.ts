/**
 * A minimal single-sample VCF 4.2 for one synthetic subject, GRCh38 with
 * `chr` contig names. Pure and byte-stable: no file date, sites sorted by
 * chromosome and position. Homozygous-reference sites are written as `0/0`
 * and no-calls as `./.`, so every catalog site has a record (a real call file
 * usually leaves reference sites out, and the Ark app prints a missing site as
 * `no call`). Every header names the file synthetic; meta lines are ASCII.
 */
import { byPosition, type Variant } from "./catalog";
import { CATALOG_VERSION, type Call } from "./genotypes";

/** GRCh38 primary assembly lengths (Ensembl `/info/assembly/homo_sapiens`, GRCh38.p14). */
export const GRCH38_CONTIGS: ReadonlyArray<readonly [string, number]> = [
  ["chr1", 248_956_422],
  ["chr2", 242_193_529],
  ["chr3", 198_295_559],
  ["chr4", 190_214_555],
  ["chr5", 181_538_259],
  ["chr6", 170_805_979],
  ["chr7", 159_345_973],
  ["chr8", 145_138_636],
  ["chr9", 138_394_717],
  ["chr10", 133_797_422],
  ["chr11", 135_086_622],
  ["chr12", 133_275_309],
  ["chr13", 114_364_328],
  ["chr14", 107_043_718],
  ["chr15", 101_991_189],
  ["chr16", 90_338_345],
  ["chr17", 83_257_441],
  ["chr18", 80_373_285],
  ["chr19", 58_617_616],
  ["chr20", 64_444_167],
  ["chr21", 46_709_983],
  ["chr22", 50_818_468],
  ["chrX", 156_040_895],
  ["chrY", 57_227_415],
  ["chrM", 16_569],
];

export const VCF_SOURCE = "TwinLLM-synthetic";

/** The sample column name: synthetic, and the subject_ref's first block only. */
export const sampleName = (subjectRef: string): string =>
  `SYNTHETIC_${subjectRef.split("-")[0] ?? subjectRef}`;

const GT: Readonly<Record<string, string>> = { "0": "0/0", "1": "0/1", "2": "1/1" };

const info = (variant: Variant): string =>
  `GENE=${variant.gene};POP_AF=${variant.altAf};SYNTHETIC`;

export const renderVcf = (subjectRef: string, calls: readonly Call[]): string => {
  const sorted = byPosition(calls.map((call) => call.variant));
  const callOf = new Map(calls.map((call) => [call.variant.rsid, call]));
  const header = [
    "##fileformat=VCFv4.2",
    `##source=${VCF_SOURCE}`,
    "##reference=GRCh38",
    `##TwinLLM_note="SYNTHETIC - not a real person. Genotypes were sampled by TwinLLM genome-synth (${CATALOG_VERSION}) for synthetic subject ${subjectRef} under Hardy-Weinberg from public allele frequencies. Research and testing only; not for clinical use."`,
    ...GRCH38_CONTIGS.map(
      ([id, length]) => `##contig=<ID=${id},length=${length},assembly=GRCh38>`,
    ),
    '##INFO=<ID=GENE,Number=1,Type=String,Description="Gene symbol (curated catalog)">',
    '##INFO=<ID=POP_AF,Number=A,Type=Float,Description="Population ALT allele frequency the synthetic genotype was sampled from (catalog af_source)">',
    '##INFO=<ID=SYNTHETIC,Number=0,Type=Flag,Description="Synthetic genotype; not from a real person">',
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    [
      "#CHROM",
      "POS",
      "ID",
      "REF",
      "ALT",
      "QUAL",
      "FILTER",
      "INFO",
      "FORMAT",
      sampleName(subjectRef),
    ].join("\t"),
  ];
  const records = sorted.map((variant) => {
    const copies = callOf.get(variant.rsid)?.altCopies ?? null;
    const genotype = copies === null ? "./." : (GT[String(copies)] ?? "./.");
    return [
      variant.chrom,
      String(variant.pos),
      variant.rsid,
      variant.ref,
      variant.alt,
      ".",
      "PASS",
      info(variant),
      "GT",
      genotype,
    ].join("\t");
  });
  return `${[...header, ...records].join("\n")}\n`;
};
