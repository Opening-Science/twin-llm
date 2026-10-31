import { TEXT_PREFIX } from "./field-crypto";

/**
 * Which columns hold personal data at rest (#141, docs/privacy-design.md
 * 2.3), table by table, with the SQL name of each and how a row finds its
 * owner. One list for the doctor's plaintext count, the migration of an
 * existing install (`bun run vault:migrate`), key rotation
 * (`bun run vault:rotate`) and the tests. The stores seal and open the same
 * columns through `field-cipher.ts`; the context of each value is
 * `<table>.<column>.<row id>` with the SQL names below.
 *
 * Pure: SQL text and functions over plain values only.
 */

/** A lookup column's value from the row's plain values, under one index key. */
type IndexOf = (column: string, value: string) => string;

export type PersonalTable = Readonly<{
  table: string;
  /** Primary key column; personal_tables is keyed by its dataset. */
  idColumn: string;
  /** SQL expression for the row's `users.id`. */
  owner: string;
  /** Extra condition for rows that must be sealed (synthetic genome reports stay plain). */
  scope?: string;
  /** Text columns sealed in personal mode. */
  sealed: readonly string[];
  /** Keyed-hash columns recomputed from the plain values whenever a row is sealed. */
  lookups?: Readonly<{
    columns: readonly string[];
    /** Lookup columns of type text[] (one hash per ID in a cell). */
    arrays?: readonly string[];
    compute: (
      plain: Readonly<Record<string, string | null>>,
      index: IndexOf,
    ) => Readonly<Record<string, string | readonly string[] | null>>;
  }>;
  /** A column that must be null in personal mode (the plain search vector). */
  plainMustBeNull?: string;
}>;

const ownerByUserId = (column: string) => `"${column}"`;

const OWNER_OF_TURN = `(SELECT t."userId" FROM "threads" t WHERE t."id" = "turns"."threadId")`;
const OWNER_OF_RESPONSE = `(SELECT t."userId" FROM "turns" u JOIN "threads" t ON t."id" = u."threadId" WHERE u."id" = "model_responses"."turnId")`;

// ─── Lookup values, shared with the stores ──────────────────────────────────

/** What `lookup_index` hashes: the code with its system, or the name of a row without one. */
export const observationLookupValue = (
  codeSystem: string | null,
  code: string | null,
  display: string,
): string => (code !== null ? `code|${codeSystem ?? ""}|${code}` : `name|${display}`);

/** What `series_index` hashes: one series is one system, code, name and unit. */
export const observationSeriesValue = (
  codeSystem: string | null,
  code: string | null,
  display: string,
  unit: string,
): string => JSON.stringify([codeSystem, code, display, unit]);

/** What `site_index` hashes: the chromosome as the file wrote it, and the position. */
export const variantSiteValue = (chrom: string, pos: string | number): string =>
  `${chrom}:${String(pos)}`;

/** The IDs of an ID cell; `rs1;rs2` holds two. */
export const variantIdsOf = (variantId: string | null): readonly string[] =>
  variantId === null ? [] : variantId.split(";").filter((id) => id.length > 0);

export const PERSONAL_TABLES: readonly PersonalTable[] = [
  { table: "threads", idColumn: "id", owner: ownerByUserId("userId"), sealed: ["title"] },
  { table: "turns", idColumn: "id", owner: OWNER_OF_TURN, sealed: ["prompt"] },
  {
    table: "model_responses",
    idColumn: "id",
    owner: OWNER_OF_RESPONSE,
    sealed: ["text", "reasoningText", "attribution", "responseDocument", "toolParts"],
  },
  {
    table: "thread_search_embeddings",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["embedding_sealed"],
    plainMustBeNull: "embedding",
  },
  {
    table: "oura_snapshots",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["summary", "fhirBundle"],
  },
  {
    table: "whoop_snapshots",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["summary", "fhirBundle"],
  },
  {
    table: "google_health_snapshots",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["summary", "fhirBundle"],
  },
  {
    table: "vitronic_snapshots",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["summary", "markers", "measures", "fhirBundle"],
  },
  {
    table: "vitronic_subjects",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["label", "consentNote"],
  },
  {
    table: "genome_reports",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    scope: `"isSynthetic" = false`,
    sealed: ["rows", "report"],
  },
  {
    table: "personal_datasets",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["name", "source_file_name", "sha256", "first_at", "last_at"],
    lookups: {
      columns: ["sha256_index"],
      compute: (plain, index) => ({
        sha256_index: plain.sha256 === null ? null : index("sha256", plain.sha256 ?? ""),
      }),
    },
  },
  {
    table: "personal_observations",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["code_system", "code", "display", "value", "unit", "source_ref", "note"],
    lookups: {
      columns: ["lookup_index", "series_index"],
      compute: (plain, index) => {
        const display = plain.display ?? "";
        const codeSystem = plain.code_system ?? null;
        const code = plain.code ?? null;
        return {
          lookup_index: index(
            "lookup",
            observationLookupValue(codeSystem, code, display),
          ),
          series_index: index(
            "series",
            observationSeriesValue(codeSystem, code, display, plain.unit ?? ""),
          ),
        };
      },
    },
  },
  {
    table: "personal_clinical_records",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["code_system", "code", "display", "status", "source_ref"],
  },
  {
    table: "personal_tables",
    idColumn: "dataset_id",
    owner: ownerByUserId("user_id"),
    sealed: ["columns"],
  },
  {
    table: "personal_table_chunks",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["rows"],
  },
  {
    table: "personal_variants",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["chrom", "pos", "variant_id", "ref", "alt", "genotype", "filter"],
    lookups: {
      columns: ["site_index", "variant_id_index"],
      arrays: ["variant_id_index"],
      compute: (plain, index) => ({
        site_index: index("site", variantSiteValue(plain.chrom ?? "", plain.pos ?? "")),
        variant_id_index: variantIdsOf(plain.variant_id ?? null).map((id) =>
          index("variant_id", id),
        ),
      }),
    },
  },
  {
    table: "twin_notes",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["title", "topics", "measures", "open_questions"],
  },
  {
    // A scheduled task's question (#54) may name a measure or a condition.
    table: "scheduled_tasks",
    idColumn: "id",
    owner: ownerByUserId("user_id"),
    sealed: ["question"],
  },
  {
    table: "onboarding_profiles",
    idColumn: "id",
    owner: ownerByUserId("userId"),
    sealed: ["interest"],
  },
  {
    // The disclosure ledger (#140) is keyed by the actor, like the audit log.
    // Synthetic rows reference synthetic values and stay plain.
    table: "disclosure_events",
    idColumn: "id",
    owner: `(SELECT u."id" FROM "users" u WHERE u."clerkId" = "disclosure_events"."actor")`,
    scope: `"synthetic" = false`,
    sealed: ["refs"],
  },
];

export const personalTable = (table: string): PersonalTable => {
  const found = PERSONAL_TABLES.find((entry) => entry.table === table);
  if (found === undefined) throw new Error(`not a personal table: ${table}`);
  return found;
};

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const notSealedWith = (column: string, prefix: string): string =>
  `(${quote(column)} IS NOT NULL AND ${quote(column)} NOT LIKE '${prefix}%')`;

const inScope = (entry: PersonalTable): string =>
  entry.scope === undefined ? "TRUE" : entry.scope;

/**
 * Rows of this table that still hold a plain value: one count per column and
 * one for the plain search vector. Never selects a value.
 */
export const plaintextCountSql = (entry: PersonalTable): string => {
  const counts = entry.sealed.map(
    (column) =>
      `count(*) FILTER (WHERE ${notSealedWith(column, TEXT_PREFIX)})::int AS ${quote(column)}`,
  );
  const vector =
    entry.plainMustBeNull === undefined
      ? []
      : [
          `count(*) FILTER (WHERE ${quote(entry.plainMustBeNull)} IS NOT NULL)::int AS ${quote(entry.plainMustBeNull)}`,
        ];
  return `SELECT ${[...counts, ...vector].join(", ")} FROM ${quote(entry.table)} WHERE ${inScope(entry)}`;
};

/** The SQL `LIKE` prefix of a value sealed with one key. */
export const keyPrefix = (keyId: string): string => `${TEXT_PREFIX}${keyId}.`;

/**
 * One batch of one owner's rows that are not yet sealed with `activeKeyId`
 * (plain, or sealed with a retiring key), in id order after `$2`. `$1` is the
 * owner's `users.id`, `$3` the batch size. Resumable: a row once rewritten no
 * longer matches, so a stopped run starts again where it left off.
 */
export const pendingRowsSql = (entry: PersonalTable, activeKeyId: string): string => {
  const pending = entry.sealed
    .map((column) => notSealedWith(column, keyPrefix(activeKeyId)))
    .join(" OR ");
  const columns = [entry.idColumn, ...entry.sealed].map(quote).join(", ");
  return [
    `SELECT ${columns} FROM ${quote(entry.table)}`,
    `WHERE ${entry.owner} = $1 AND ${inScope(entry)} AND ${quote(entry.idColumn)} > $2`,
    `AND (${pending})`,
    `ORDER BY ${quote(entry.idColumn)} LIMIT $3`,
  ].join(" ");
};

/** Rewrites one row: every sealed column, then the lookup columns, keyed by the id (last parameter). */
export const updateRowSql = (entry: PersonalTable): string => {
  const columns = [...entry.sealed, ...(entry.lookups?.columns ?? [])];
  const arrays = entry.lookups?.arrays ?? [];
  const sets = columns.map(
    (column, index) =>
      `${quote(column)} = $${index + 1}${arrays.includes(column) ? "::text[]" : ""}`,
  );
  return `UPDATE ${quote(entry.table)} SET ${sets.join(", ")} WHERE ${quote(entry.idColumn)} = $${columns.length + 1}`;
};

/** How many of one owner's rows name a key; zero before a retiring key is removed. */
export const rowsWithKeySql = (entry: PersonalTable, keyId: string): string =>
  `SELECT count(*)::int AS n FROM ${quote(entry.table)} WHERE ${entry.owner} = $1 AND (${entry.sealed
    .map((column) => `${quote(column)} LIKE '${keyPrefix(keyId)}%'`)
    .join(" OR ")})`;
