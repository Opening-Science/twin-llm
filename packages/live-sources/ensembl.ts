import { ENSEMBL_ORIGIN } from "./constants";
import type { LiveCitation } from "./pubmed";

/**
 * Pure helpers for the Ensembl REST API: a human gene by symbol, a variant by
 * rsID. No network here; `tools.ts` sends through the ledgered fetch.
 */

export type EnsemblGene = Readonly<{
  kind: "gene";
  id: string;
  symbol: string;
  description: string | null;
  biotype: string | null;
  location: string | null;
  strand: number | null;
  assembly: string | null;
  url: string;
}>;

export type EnsemblVariantMapping = Readonly<{
  location: string;
  alleles: string | null;
  assembly: string | null;
}>;

export type EnsemblVariant = Readonly<{
  kind: "variant";
  rsid: string;
  variantClass: string | null;
  mostSevereConsequence: string | null;
  minorAllele: string | null;
  minorAlleleFrequency: number | null;
  clinicalSignificance: readonly string[];
  mappings: readonly EnsemblVariantMapping[];
  url: string;
}>;

/** Mappings returned at most; a variant on many patches lists only the first ones. */
export const MAX_MAPPINGS = 5;

export const geneLookupUrl = (symbol: string): string =>
  `${ENSEMBL_ORIGIN}/lookup/symbol/homo_sapiens/${encodeURIComponent(symbol)}?content-type=application/json`;

export const variantLookupUrl = (rsid: string): string =>
  `${ENSEMBL_ORIGIN}/variation/homo_sapiens/${encodeURIComponent(rsid)}?content-type=application/json`;

export const ensemblGeneUrl = (id: string): string =>
  `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(id)}`;

export const ensemblVariantUrl = (rsid: string): string =>
  `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=${encodeURIComponent(rsid)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** "apolipoprotein E [Source:HGNC Symbol;Acc:HGNC:613]" reads "apolipoprotein E". */
const withoutSourceNote = (value: string | null): string | null =>
  value === null ? null : value.replace(/\s*\[Source:[^\]]*\]\s*$/, "").trim() || null;

const objectBody = (body: string, code: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error(code);
  return parsed;
};

export const parseGene = (body: string): EnsemblGene => {
  const record = objectBody(body, "ENSEMBL_GENE_MALFORMED");
  const id = text(record.id);
  const symbol = text(record.display_name);
  if (id === null || symbol === null) throw new Error("ENSEMBL_GENE_MALFORMED");
  const region = text(record.seq_region_name);
  const start = finite(record.start);
  const end = finite(record.end);
  return {
    kind: "gene",
    id,
    symbol,
    description: withoutSourceNote(text(record.description)),
    biotype: text(record.biotype),
    location:
      region === null || start === null || end === null
        ? null
        : `${region}:${String(start)}-${String(end)}`,
    strand: finite(record.strand),
    assembly: text(record.assembly_name),
    url: ensemblGeneUrl(id),
  };
};

export const parseVariant = (body: string): EnsemblVariant => {
  const record = objectBody(body, "ENSEMBL_VARIANT_MALFORMED");
  const rsid = text(record.name);
  if (rsid === null) throw new Error("ENSEMBL_VARIANT_MALFORMED");
  const mappings = Array.isArray(record.mappings) ? record.mappings : [];
  const significance = Array.isArray(record.clinical_significance)
    ? record.clinical_significance
    : [];
  return {
    kind: "variant",
    rsid,
    variantClass: text(record.var_class),
    mostSevereConsequence: text(record.most_severe_consequence),
    minorAllele: text(record.minor_allele),
    minorAlleleFrequency: finite(record.MAF),
    clinicalSignificance: significance.filter(
      (item): item is string => typeof item === "string",
    ),
    mappings: mappings
      .filter(isRecord)
      .flatMap((mapping) => {
        const location = text(mapping.location);
        return location === null
          ? []
          : [
              {
                location,
                alleles: text(mapping.allele_string),
                assembly: text(mapping.assembly_name),
              },
            ];
      })
      .slice(0, MAX_MAPPINGS),
    url: ensemblVariantUrl(rsid),
  };
};

export const ensemblCitation = (fact: EnsemblGene | EnsemblVariant): LiveCitation =>
  fact.kind === "gene"
    ? {
        source: "Ensembl",
        id: fact.id,
        title: `${fact.symbol} gene (Ensembl ${fact.id})`,
        url: fact.url,
      }
    : {
        source: "Ensembl",
        id: fact.rsid,
        title: `${fact.rsid} variant (Ensembl)`,
        url: fact.url,
      };
