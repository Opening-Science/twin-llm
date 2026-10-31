import { z } from "zod";

import {
  PUBMED_DEFAULT_LIMIT,
  PUBMED_MAX_LIMIT,
  QUERY_MAX_CHARS,
  QUERY_MIN_CHARS,
} from "./constants";

/**
 * The live tools' inputs: closed objects with capped fields. What a field may
 * contain is checked again by `query-check.ts` before anything is sent, so a
 * refusal comes back with a code and a plain sentence.
 */

export const pubmedSearchInput = z
  .object({
    query: z
      .string()
      .min(QUERY_MIN_CHARS)
      .max(QUERY_MAX_CHARS)
      .describe(
        "Search terms in words, such as atrial fibrillation heart rate variability. Never a value, date, name or identifier of the person.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PUBMED_MAX_LIMIT)
      .default(PUBMED_DEFAULT_LIMIT)
      .describe("Articles to return, 1 to 10."),
  })
  .strict();

export type PubmedSearchInput = z.infer<typeof pubmedSearchInput>;

export const ensemblLookupInput = z
  .object({
    symbol: z
      .string()
      .min(1)
      .max(20)
      .optional()
      .describe("A human gene symbol, such as BRCA1. Give this or rsid."),
    rsid: z
      .string()
      .min(3)
      .max(14)
      .optional()
      .describe("A dbSNP rsID, such as rs429358. Give this or symbol."),
  })
  .strict();

export type EnsemblLookupInput = z.infer<typeof ensemblLookupInput>;

/** Exactly one of the two keys, or null when the call gave none or both. */
export const lookupKeyOf = (
  input: EnsemblLookupInput,
): Readonly<{ symbol: string }> | Readonly<{ rsid: string }> | null => {
  const symbol = input.symbol?.trim();
  const rsid = input.rsid?.trim();
  if (symbol && !rsid) return { symbol: symbol.toUpperCase() };
  if (rsid && !symbol) return { rsid: rsid.toLowerCase() };
  return null;
};
