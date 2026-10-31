import { QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "./constants";

/**
 * The check every live lookup's terms pass before anything is recorded or
 * sent. The terms come only from the model's tool arguments, and the model
 * has the person's data in front of it, so a value could slip into a query.
 * Nothing here can tell a personal value from a public one (the free-text
 * matcher of #112 was not built), so the check is a conservative pattern
 * filter: no digit outside a gene symbol or an rsID, no year or date, no
 * address or identifier, a small character set. A refused query is never
 * sent, and the refusal says why in plain words.
 *
 * Pure: no I/O.
 */

export type QueryRefusalReason =
  "length" | "characters" | "identifier" | "date" | "number" | "genome-rsid";

/** Kinds of term a query carried, counted, for the audit row. Never the terms. */
export type QueryTerms = Readonly<{ words: number; geneSymbols: number; rsids: number }>;

export type QueryCheck =
  | Readonly<{ ok: true; terms: QueryTerms }>
  | Readonly<{ ok: false; reason: QueryRefusalReason }>;

export const RSID_PATTERN = /^rs\d{1,12}$/;
/** HGNC-style: upper-case letters and digits, one optional hyphenated part. */
const GENE_SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,9}(?:-[A-Z0-9]{1,6})?$/;
const ALLOWED_CHARACTERS = /^[A-Za-z0-9 \-'"(),*[\]]+$/;
const ADDRESS = /@|:\/\/|www\./i;
const YEAR = /\b(?:1[89]|20)\d{2}\b/;
const BOOLEAN_WORDS: ReadonlySet<string> = new Set(["AND", "OR", "NOT"]);

const digitCount = (token: string): number => token.replace(/\D/g, "").length;

/**
 * A gene symbol may carry digits (`CYP2C19`, `HLA-DRB1`, `BRCA1`), but at most
 * three, never three in a row, so a stray value such as `HR72BP140` is not
 * waved through as a gene.
 */
export const isGeneSymbol = (token: string): boolean =>
  GENE_SYMBOL_PATTERN.test(token) && digitCount(token) <= 3 && !/\d{3}/.test(token);

export const isRsid = (token: string): boolean => RSID_PATTERN.test(token);

type Kind = "word" | "gene" | "rsid" | "number";

const kindOf = (token: string): Kind => {
  if (isRsid(token.toLowerCase())) return "rsid";
  const hasDigit = /\d/.test(token);
  if (
    isGeneSymbol(token) &&
    !BOOLEAN_WORDS.has(token) &&
    (hasDigit || token.length > 1)
  ) {
    return "gene";
  }
  return hasDigit ? "number" : "word";
};

/**
 * Checks free search terms (`pubmed_search`). `genomeInTurn` is true when the
 * person's genome is part of this chat turn: then an rsID is refused too, so a
 * lookup cannot show which variants the person carries.
 */
export const checkSearchTerms = (
  text: string,
  options: Readonly<{ genomeInTurn: boolean }>,
): QueryCheck => {
  const query = text.trim();
  if (query.length < QUERY_MIN_CHARS || query.length > QUERY_MAX_CHARS) {
    return { ok: false, reason: "length" };
  }
  if (ADDRESS.test(query)) return { ok: false, reason: "identifier" };
  if (!ALLOWED_CHARACTERS.test(query)) return { ok: false, reason: "characters" };
  if (YEAR.test(query)) return { ok: false, reason: "date" };
  const kinds = query
    .split(/[^A-Za-z0-9-]+/)
    .filter((token) => token.replace(/-/g, "") !== "")
    .map(kindOf);
  if (kinds.includes("number")) return { ok: false, reason: "number" };
  const terms: QueryTerms = {
    words: kinds.filter((kind) => kind === "word").length,
    geneSymbols: kinds.filter((kind) => kind === "gene").length,
    rsids: kinds.filter((kind) => kind === "rsid").length,
  };
  if (terms.words + terms.geneSymbols + terms.rsids === 0) {
    return { ok: false, reason: "length" };
  }
  if (options.genomeInTurn && terms.rsids > 0)
    return { ok: false, reason: "genome-rsid" };
  return { ok: true, terms };
};

/** Checks one Ensembl lookup key: a gene symbol or an rsID, nothing else. */
export const checkLookupKey = (
  key: Readonly<{ symbol: string } | { rsid: string }>,
  options: Readonly<{ genomeInTurn: boolean }>,
): QueryCheck => {
  if ("symbol" in key) {
    return isGeneSymbol(key.symbol)
      ? { ok: true, terms: { words: 0, geneSymbols: 1, rsids: 0 } }
      : { ok: false, reason: /\d/.test(key.symbol) ? "number" : "characters" };
  }
  if (!isRsid(key.rsid)) return { ok: false, reason: "characters" };
  if (options.genomeInTurn) return { ok: false, reason: "genome-rsid" };
  return { ok: true, terms: { words: 0, geneSymbols: 0, rsids: 1 } };
};

/** What a person (and the model) reads when a query is refused. */
export const QUERY_REFUSAL_SENTENCES: Readonly<Record<QueryRefusalReason, string>> = {
  length: "The search needs 3 to 200 characters of search terms, so nothing was sent.",
  characters:
    "Search terms may use letters, spaces, hyphens, quotes, brackets and commas, so nothing was sent.",
  identifier: "That looks like an address or an identifier, so nothing was sent.",
  date: "Search terms may not contain a year or a date, so nothing was sent.",
  number:
    "Search terms may not contain numbers other than in gene symbols and rsIDs, so nothing was sent. Write the topic in words.",
  "genome-rsid":
    "An rsID is not sent while your genome is part of this chat, so a lookup cannot show which variants you carry. Ask about the gene instead.",
};
