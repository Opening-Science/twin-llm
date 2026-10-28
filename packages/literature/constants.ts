/**
 * Specialty literature: open-licence articles fetched to a gitignored folder
 * and embedded into the guideline tables with source `literature:<specialty>`.
 * See docs/literature.md for the licence reasoning behind every value here.
 */

/** Repo-relative folder for downloaded text. Gitignored; never commit it. */
export const LITERATURE_DIR = "data/literature" as const;

/** `guideline_documents.source` is this prefix plus the specialty id. */
export const LITERATURE_SOURCE_PREFIX = "literature:" as const;

/** NCBI E-utilities (PMC search). */
export const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils" as const;

/** NLM's PMC Article Datasets bucket (per-article JSON metadata with licence_code). */
export const PMC_S3_BASE = "https://pmc-oa-opendata.s3.amazonaws.com" as const;

/**
 * The `tool` parameter NCBI asks E-utilities callers to send: one string
 * without spaces naming the software. The `email` parameter must be the
 * developer's own address, so it is only sent when the operator passes one.
 */
export const EUTILS_TOOL = "twinllm" as const;

/**
 * NCBI asks for at most three requests per second without an API key. One
 * request every 400 ms stays under that, and the same spacing is used for the
 * PMC bucket so the whole run is gentle.
 */
export const REQUEST_INTERVAL_MS = 400 as const;

/** Largest article text the fetch reads, in bytes. */
export const MAX_ARTICLE_BYTES = 4_000_000 as const;
/** Largest metadata or search response the fetch reads, in bytes. */
export const MAX_METADATA_BYTES = 1_000_000 as const;

export const DEFAULT_FETCH_LIMIT = 20 as const;
export const MAX_FETCH_LIMIT = 500 as const;
