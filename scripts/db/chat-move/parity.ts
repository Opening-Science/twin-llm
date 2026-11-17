/**
 * bun run db:chat-parity
 *
 * The parity gate of the chat tables move (DATA-MODEL.md C.3), read-only:
 * per table pair the row counts, ids on one side only and rows whose copy
 * differs from the old row in any column (sealed text byte for byte,
 * numbers exactly, times as instants), then orphans in the new tables.
 * Needs no keys: a sealed value equal byte for byte, with its row id and
 * context name unchanged, opens exactly as the old one does. Exit code 1
 * when any count is not as it should be. Prints table names and counts only.
 *
 * The database is DATABASE_URL, as for the app.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { sealContextOf } from "@/infrastructure/chat-seal-contexts";
import type { FieldCipher } from "@/infrastructure/field-cipher";

import { countsSql, ORPHAN_CHECKS, sealedPairsSql } from "./parity-sql";
import { CHAT_MOVES } from "./tables";

export type TableParity = Readonly<{
  table: string;
  oldRows: number;
  newRows: number;
  /** Old rows with no copy. */
  missing: number;
  /** Copies with no old row. */
  extra: number;
  /** Rows on both sides whose copy differs in any column. */
  differing: number;
}>;

export type ParityReport = Readonly<{
  tables: readonly TableParity[];
  orphans: Readonly<Record<string, number>>;
  ok: boolean;
}>;

type CountsRow = {
  old_rows: number;
  new_rows: number;
  missing: number;
  extra: number;
  differing: number;
};

export const checkParity = async (db: PrismaClient): Promise<ParityReport> => {
  const tables: TableParity[] = [];
  for (const move of CHAT_MOVES) {
    const [row] = await db.$queryRawUnsafe<CountsRow[]>(countsSql(move));
    tables.push({
      table: move.to,
      oldRows: row?.old_rows ?? -1,
      newRows: row?.new_rows ?? -1,
      missing: row?.missing ?? -1,
      extra: row?.extra ?? -1,
      differing: row?.differing ?? -1,
    });
  }
  const orphans: Record<string, number> = {};
  for (const check of ORPHAN_CHECKS) {
    const [row] = await db.$queryRawUnsafe<{ n: number }[]>(check.sql);
    orphans[check.name] = row?.n ?? -1;
  }
  const ok =
    tables.every(
      (table) =>
        table.oldRows === table.newRows &&
        table.missing === 0 &&
        table.extra === 0 &&
        table.differing === 0,
    ) && Object.values(orphans).every((n) => n === 0);
  return { tables, orphans, ok };
};

export const reportLines = (report: ParityReport): readonly string[] => [
  ...report.tables.map(
    (table) =>
      `${table.table}: ${table.oldRows} old, ${table.newRows} new, ${table.missing} missing, ${table.extra} extra, ${table.differing} differing`,
  ),
  ...Object.entries(report.orphans).map(([name, n]) => `${name}: ${n}`),
  report.ok ? "parity OK" : "parity FAIL",
];

export type OpenProblems = Readonly<Record<string, number>>;

/**
 * With the vault unlocked (DATA-MODEL.md C.3, last check): opens every
 * sealed value of the given owners through the old names and through the
 * new tables' frozen contexts, and counts per column the values that did not
 * open on either side, or opened to different text. Owners `cipherOf`
 * returns null for are skipped. Values never leave this
 * function. An empty result is a pass.
 */
export const openProblems = async (
  db: PrismaClient,
  cipherOf: (ownerId: string) => FieldCipher | null,
): Promise<OpenProblems> => {
  const problems: Record<string, number> = {};
  for (const move of CHAT_MOVES) {
    for (const column of move.columns.filter((c) => c.to.endsWith("_sealed"))) {
      const rows = await db.$queryRawUnsafe<
        {
          id: string;
          owner_id: string;
          old_value: string | null;
          new_value: string | null;
        }[]
      >(sealedPairsSql(move, column));
      const context = sealContextOf(move.to, column.to);
      const open = (
        cipher: FieldCipher,
        table: string,
        name: string,
        id: string,
        stored: string | null,
      ): string | null | undefined => {
        if (stored === null) return null;
        try {
          return cipher.openText(table, name, id, stored);
        } catch {
          return undefined;
        }
      };
      for (const row of rows) {
        const cipher = cipherOf(row.owner_id);
        if (cipher === null) continue;
        const want = open(cipher, move.from, column.from, row.id, row.old_value);
        const got =
          context === null
            ? undefined
            : open(cipher, context.table, context.column, row.id, row.new_value);
        if (got === undefined || got !== want) {
          const key = `${move.to}.${column.to}`;
          problems[key] = (problems[key] ?? 0) + 1;
        }
      }
    }
  }
  return problems;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { database } = await import("../../../infrastructure/database");
  const db = database();
  try {
    const report = await checkParity(db);
    for (const line of reportLines(report)) console.log(line);
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error("db:chat-parity FAIL: the database refused a query");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
