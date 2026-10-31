import { type FieldCipher } from "./field-cipher";
import { isSealedText, sealedTextKeyId } from "./field-crypto";
import {
  PERSONAL_TABLES,
  type PersonalTable,
  pendingRowsSql,
  plaintextCountSql,
  rowsWithKeySql,
  updateRowSql,
} from "./personal-columns";

/**
 * Sealing one person's rows in place (#141): the migration of an existing
 * personal install (`bun run vault:migrate`) and key rotation
 * (`bun run vault:rotate`) are the same walk. Every row of the person whose
 * personal columns are not all sealed with the active key (plain, or sealed
 * with a retiring key) is opened, sealed again with the active key, checked
 * by opening the new value and comparing, and written with its lookup hashes
 * recomputed, in batches of `batchSize` rows per transaction.
 *
 * Resumable and idempotent: the walk only ever selects rows that still need
 * work, so a run stopped at any point starts again where it left off, and a
 * second run over finished rows changes nothing. It stops at the first value
 * that does not open or does not check, before that batch is written.
 *
 * No I/O of its own: SQL goes through the port. Values never reach a log.
 */

export type SqlRow = Readonly<Record<string, unknown>>;
export type SqlRun = (
  sql: string,
  params: readonly unknown[],
) => Promise<readonly SqlRow[]>;

export type ResealPorts = Readonly<{
  query: SqlRun;
  /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
  transaction: <T>(work: (query: SqlRun) => Promise<T>) => Promise<T>;
  /** One line per finished batch: table name and counts only. */
  progress?: (table: string, rows: number) => void;
}>;

export const DEFAULT_BATCH = 500;

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error("a personal column did not read as text");
};

/** `{"a","b"}`: a text[] literal for a list of lookup hashes (hex, never quotes). */
export const textArrayLiteral = (items: readonly string[]): string =>
  `{${items.map((item) => `"${item}"`).join(",")}}`;

export class ResealCheckError extends Error {
  constructor(table: string, column: string) {
    super(`resealed value did not check: ${table}.${column}`);
    this.name = "ResealCheckError";
  }
}

/** The new values of one row: every sealed column, then the lookup columns. */
export const resealRow = (
  cipher: FieldCipher,
  entry: PersonalTable,
  row: SqlRow,
): readonly unknown[] => {
  const id = asText(row[entry.idColumn]);
  if (id === null) throw new Error("row without id");
  const active = cipher.activeKeyId;
  if (active === null) throw new Error("resealing needs a sealed cipher");
  const plain: Record<string, string | null> = {};
  const sealed = entry.sealed.map((column) => {
    const stored = asText(row[column]);
    if (stored === null) {
      plain[column] = null;
      return null;
    }
    const value = isSealedText(stored)
      ? cipher.openText(entry.table, column, id, stored)
      : stored;
    plain[column] = value;
    if (sealedTextKeyId(stored) === active) return stored;
    const next = cipher.sealText(entry.table, column, id, value);
    if (cipher.openText(entry.table, column, id, next) !== value) {
      throw new ResealCheckError(entry.table, column);
    }
    return next;
  });
  const lookups = entry.lookups;
  if (lookups === undefined) return [...sealed, id];
  const computed = lookups.compute(plain, (column, value) =>
    cipher.index(entry.table, column, value),
  );
  const lookupValues = lookups.columns.map((column) => {
    const value = computed[column];
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? value : textArrayLiteral(value);
  });
  return [...sealed, ...lookupValues, id];
};

/** Reseals one table's pending rows of one owner; returns how many rows were written. */
export const resealTable = async (
  ports: ResealPorts,
  cipher: FieldCipher,
  entry: PersonalTable,
  ownerId: string,
  batchSize: number = DEFAULT_BATCH,
): Promise<number> => {
  const active = cipher.activeKeyId;
  if (active === null) throw new Error("resealing needs a sealed cipher");
  const select = pendingRowsSql(entry, active);
  const update = updateRowSql(entry);
  let after = "";
  let written = 0;
  for (;;) {
    const rows = await ports.query(select, [ownerId, after, batchSize]);
    if (rows.length === 0) return written;
    // Every value is opened, resealed and checked before the batch is written.
    const updates = rows.map((row) => resealRow(cipher, entry, row));
    await ports.transaction(async (query) => {
      for (const params of updates) await query(update, params);
    });
    written += rows.length;
    after = asText(rows[rows.length - 1]?.[entry.idColumn]) ?? after;
    ports.progress?.(entry.table, written);
  }
};

export type ResealCounts = Readonly<Record<string, number>>;

/** Every personal table of one owner, in registry order. */
export const resealOwner = async (
  ports: ResealPorts,
  cipher: FieldCipher,
  ownerId: string,
  batchSize: number = DEFAULT_BATCH,
): Promise<ResealCounts> => {
  const counts: Record<string, number> = {};
  for (const entry of PERSONAL_TABLES) {
    counts[entry.table] = await resealTable(ports, cipher, entry, ownerId, batchSize);
  }
  return counts;
};

/** How many of one owner's rows still name `keyId`; zero before that key is removed. */
export const rowsWithKey = async (
  query: SqlRun,
  ownerId: string,
  keyId: string,
): Promise<number> => {
  let total = 0;
  for (const entry of PERSONAL_TABLES) {
    const [row] = await query(rowsWithKeySql(entry, keyId), [ownerId]);
    total += Number(row?.n ?? 0);
  }
  return total;
};

export type PlaintextFinding = Readonly<{ table: string; column: string; rows: number }>;

/**
 * Every listed column that still holds a plain value, with how many rows, for
 * the doctor and the Lab: table and column names and counts, never a value.
 */
export const plaintextFindings = async (
  query: SqlRun,
): Promise<readonly PlaintextFinding[]> => {
  const findings: PlaintextFinding[] = [];
  for (const entry of PERSONAL_TABLES) {
    const [row] = await query(plaintextCountSql(entry), []);
    for (const [column, count] of Object.entries(row ?? {})) {
      const rows = Number(count);
      if (rows > 0) findings.push({ table: entry.table, column, rows });
    }
  }
  return findings;
};

/** Lines for the doctor: `[ok]` when nothing is plain, else one line per column. */
export const formatPlaintextFindings = (
  findings: readonly PlaintextFinding[],
): readonly string[] =>
  findings.length === 0
    ? ["  [ok] every listed personal column holds sealed values (tlenc1.)"]
    : findings.map(
        (finding) =>
          `  [!!] ${finding.table}.${finding.column}: ${finding.rows} row(s) not sealed; run bun run vault:migrate (docs/runbook.md)`,
      );
