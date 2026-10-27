/** Caps for one import. A file over a cap is refused with a sentence, never cut. */

/** 50 MB per file. An Apple Health export (often larger) is a later change (#178). */
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
