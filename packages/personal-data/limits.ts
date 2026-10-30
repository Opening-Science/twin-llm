/** Caps for one import. A file over a cap is refused with a sentence, never cut. */

/**
 * 50 MB per file, a zip counted as uploaded. An Apple Health export zip over
 * 50 MB is refused like any other file.
 */
export const MAX_FILE_BYTES = 50_000_000;

/** Columns in a research table. */
export const MAX_COLUMNS = 200;

/** Data rows in a research table or lab CSV, and numbers in one FHIR file. */
export const MAX_ROWS = 200_000;

/** Research-table rows per stored chunk (`personal_table_chunks.rows`). */
export const CHUNK_ROWS = 1_000;

/** Rows the review lists one by one; the rest are counted by reason. */
export const MAX_UNMAPPED_LISTED = 50;

/** Rows the review previews. */
export const PREVIEW_ROWS = 20;

/** Distinct codes the review lists. */
export const MAX_CODES_LISTED = 50;

/** Characters kept from a dataset name. */
export const MAX_NAME_LENGTH = 120;

/**
 * A VCF's text after gzip, read as a stream and never held whole. A file whose
 * text runs past this is refused; 500 MB is far more than 200,000 records need.
 */
export const MAX_VCF_TEXT_BYTES = 500_000_000;

/**
 * Variant records stored from one VCF. More is refused, not cut. An exome or a
 * filtered call set fits; a whole genome (4 to 5 million records) does not yet.
 */
export const MAX_VARIANTS = 200_000;
