/**
 * Live public lookups (#6): a small, allowlisted, read-only tool layer over
 * public databases. Each source is off until the person turns it on, and every
 * request is written to the disclosure ledger (#140) before it is sent.
 */

export const PUBMED_SEARCH_TOOL = "pubmed_search" as const;
export const ENSEMBL_LOOKUP_TOOL = "ensembl_lookup" as const;

export const PUBMED_AUDIT_TOOL = "live.pubmed_search" as const;
export const ENSEMBL_AUDIT_TOOL = "live.ensembl_lookup" as const;

/** The only origins this layer may reach. Anything else is refused before the ledger. */
export const EUTILS_ORIGIN = "https://eutils.ncbi.nlm.nih.gov" as const;
export const ENSEMBL_ORIGIN = "https://rest.ensembl.org" as const;
export const ALLOWED_ORIGINS: readonly string[] = [EUTILS_ORIGIN, ENSEMBL_ORIGIN];

export const EUTILS_BASE = `${EUTILS_ORIGIN}/entrez/eutils` as const;

/** Who the ledger names as the recipient. */
export const PUBMED_RECIPIENT = "NCBI PubMed" as const;
export const ENSEMBL_RECIPIENT = "Ensembl" as const;

/** The default E-utilities `tool` value; `NCBI_TOOL` overrides it. */
export const DEFAULT_NCBI_TOOL = "twinllm" as const;

/**
 * NCBI asks for at most three requests per second without an API key, and
 * Ensembl for at most fifteen. One request every 400 ms and 100 ms stays under
 * both, across every chat on this server.
 */
export const NCBI_INTERVAL_MS = 400 as const;
export const ENSEMBL_INTERVAL_MS = 100 as const;

/** A request that has not answered in this time is dropped and not retried. */
export const REQUEST_TIMEOUT_MS = 15_000 as const;

/** Largest response body read, in bytes. A larger one fails the lookup. */
export const MAX_RESPONSE_BYTES = 1_000_000 as const;

/** How long an answer is kept on this machine before it is asked for again. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Answers kept at most; the oldest goes first. */
export const CACHE_MAX_ENTRIES = 200 as const;

export const QUERY_MIN_CHARS = 3 as const;
export const QUERY_MAX_CHARS = 200 as const;
export const PUBMED_DEFAULT_LIMIT = 5 as const;
export const PUBMED_MAX_LIMIT = 10 as const;
/** Characters of an abstract returned to the model. */
export const ABSTRACT_SNIPPET_CHARS = 300 as const;

/** Every live source, in the order screens list them. */
export const LIVE_SOURCE_IDS = ["pubmed", "ensembl"] as const;

export type LiveSourceId = (typeof LIVE_SOURCE_IDS)[number];
