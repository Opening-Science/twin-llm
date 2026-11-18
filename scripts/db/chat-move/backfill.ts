/**
 * bun run db:chat-backfill [--batch-size=1000]
 *
 * Copies every row of threads, turns and model_responses into
 * conversations, exchanges and answers (DATA-MODEL.md C.2), then adds the
 * new tables' foreign keys and marks the move `backfilled`. Run it after the
 * expand and mirror migrations, with the app running or not: rows written
 * meanwhile are copied by the mirror triggers.
 *
 * Safe to stop and to run again: each batch is one transaction, the
 * position per table is kept in schema_move_cursors, and a run after a
 * finished one inserts nothing. Needs no keys: sealed values are copied as
 * stored. Prints table names and counts only.
 *
 * The database is DATABASE_URL, as for the app.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import {
  ADVANCE_CURSOR_SQL,
  addConstraintSql,
  CLEAR_LOST_SCHEDULES_SQL,
  FINISH_CONSTRAINTS,
  LOCK_CURSOR_SQL,
  MARK_BACKFILLED_SQL,
  MOVE,
  batchSql,
  validateConstraintSql,
} from "./backfill-sql";
import { CHAT_MOVES, type TableMove } from "./tables";

export type BackfillOptions = Readonly<{
  batchSize: number;
  /** Stop after this many batches in all (a rehearsal of a stopped run). */
  maxBatches?: number;
  /** Called after each committed batch; tests write here, as the app would. */
  afterBatch?: (table: string) => Promise<void>;
  log: (line: string) => void;
}>;

export type TableResult = Readonly<{ table: string; read: number; inserted: number }>;

export type BackfillResult = Readonly<{
  tables: readonly TableResult[];
  /** False when maxBatches stopped the run before the last table was done. */
  complete: boolean;
}>;

type BatchRow = { last_id: string | null; seen: number; inserted: number };

/** One batch in its own transaction; null when the table has nothing left. */
const copyBatch = async (
  db: PrismaClient,
  move: TableMove,
  batchSize: number,
): Promise<BatchRow> =>
  db.$transaction(async (tx) => {
    const [cursor] = await tx.$queryRawUnsafe<{ last_id: string | null }[]>(
      LOCK_CURSOR_SQL,
      MOVE,
      move.to,
    );
    const [row] = await tx.$queryRawUnsafe<BatchRow[]>(
      batchSql(move),
      cursor?.last_id ?? null,
      batchSize,
    );
    const batch = row ?? { last_id: null, seen: 0, inserted: 0 };
    if (batch.seen > 0) {
      await tx.$executeRawUnsafe(
        ADVANCE_CURSOR_SQL,
        MOVE,
        move.to,
        batch.last_id,
        batch.inserted,
      );
    }
    return batch;
  });

export const runBackfill = async (
  db: PrismaClient,
  options: BackfillOptions,
): Promise<BackfillResult> => {
  const tables: TableResult[] = [];
  let batches = 0;
  for (const move of CHAT_MOVES) {
    let read = 0;
    let inserted = 0;
    for (;;) {
      if (options.maxBatches !== undefined && batches >= options.maxBatches) {
        tables.push({ table: move.to, read, inserted });
        options.log(`${move.to}: stopped after ${read} read, ${inserted} copied`);
        return { tables, complete: false };
      }
      const batch = await copyBatch(db, move, options.batchSize);
      batches += 1;
      read += batch.seen;
      inserted += batch.inserted;
      if (batch.seen > 0) await options.afterBatch?.(move.to);
      if (batch.seen < options.batchSize) break;
    }
    tables.push({ table: move.to, read, inserted });
    options.log(`${move.to}: ${read} read, ${inserted} copied`);
  }
  return { tables, complete: true };
};

/**
 * Adds the foreign keys and the schedule check, each NOT VALID and then
 * validated (no long lock on writers), and marks the move backfilled.
 * Validation fails, and the move stays `expanded`, if any copy is orphaned.
 */
export const finishBackfill = async (
  db: PrismaClient,
  log: (line: string) => void,
): Promise<void> => {
  const cleared = await db.$executeRawUnsafe(CLEAR_LOST_SCHEDULES_SQL);
  if (cleared > 0) log(`exchanges: ${cleared} schedules of deleted tasks cleared`);
  for (const constraint of FINISH_CONSTRAINTS) {
    await db.$executeRawUnsafe(addConstraintSql(constraint));
    await db.$executeRawUnsafe(validateConstraintSql(constraint));
    log(`${constraint.table}: ${constraint.name} holds`);
  }
  await db.$executeRawUnsafe(MARK_BACKFILLED_SQL, MOVE);
  log(`${MOVE}: backfilled`);
};

/** `--batch-size=N`, a whole number from 1 to 10,000; 1,000 by default. */
export const batchSizeOf = (args: readonly string[]): number | null => {
  const flag = args.find((arg) => arg.startsWith("--batch-size="));
  if (flag === undefined) return 1000;
  const value = Number(flag.slice("--batch-size=".length));
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : null;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const batchSize = batchSizeOf(process.argv.slice(2));
  if (batchSize === null) {
    console.error("usage: bun run db:chat-backfill [--batch-size=1..10000]");
    process.exit(1);
  }
  const { database } = await import("../../../infrastructure/database");
  const db = database();
  const log = (line: string) => console.log(line);
  try {
    const marker = await db.schemaMove.findUnique({ where: { move: MOVE } });
    if (marker === null) {
      console.error(`db:chat-backfill: no ${MOVE} move in progress; run db:deploy first`);
      process.exit(1);
    }
    let step = "copy";
    try {
      await runBackfill(db, { batchSize, log });
      step = "finish";
      await finishBackfill(db, log);
    } catch {
      // The database's own message can quote row values; name the step only.
      console.error(
        `db:chat-backfill FAIL during ${step}: nothing was lost; the next run resumes`,
      );
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}
