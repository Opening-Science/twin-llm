import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { SavePlan } from "@/packages/personal-data/save-plan";
import {
  type EffectivePrecision,
  IMPORT_KINDS,
  isGenomeImportKind,
  isImportKind,
  type ImportKind,
} from "@/packages/personal-data/types";
import {
  type ImportedDataPorts,
  type ImportedObservationRecord,
  LOINC_SYSTEM,
} from "@/packages/query-tools/imported-ports";

import { database } from "./database";

/**
 * Reads and writes the personal_* tables: a person's imported files
 * (docs/personal-data.md). Every query is scoped to one `userId`, so one
 * person never reads, renames or deletes another's dataset. Callers check
 * the data-mode policy and write the audit row; this module only touches rows.
 *
 * Lives in infrastructure because two features need it: Customize · Data
 * imports and deletes, and the chat tools read it (`importedDataReads`).
 */

export type DatasetView = Readonly<{
  id: string;
  kind: ImportKind;
  name: string;
  sourceFileName: string;
  rowCount: number;
  firstAt: string | null;
  lastAt: string | null;
  createdAt: string;
}>;

export type SaveOutcome =
  | Readonly<{ ok: true; dataset: DatasetView }>
  | Readonly<{ ok: false; reason: "duplicate" }>;

export type PersonalDataStore = Readonly<{
  list: (userId: string) => Promise<readonly DatasetView[]>;
  findBySha: (userId: string, sha256: string) => Promise<DatasetView | null>;
  save: (plan: SavePlan) => Promise<SaveOutcome>;
  rename: (userId: string, id: string, name: string) => Promise<DatasetView | null>;
  /** Hard delete with every row; the number of rows it held, or null when not found. */
  remove: (userId: string, id: string) => Promise<number | null>;
}>;

const SELECT = {
  id: true,
  kind: true,
  name: true,
  sourceFileName: true,
  rowCount: true,
  firstAt: true,
  lastAt: true,
  createdAt: true,
} as const;

type Row = Readonly<{
  id: string;
  kind: string;
  name: string;
  sourceFileName: string;
  rowCount: number;
  firstAt: string | null;
  lastAt: string | null;
  createdAt: Date;
}>;

const toView = (row: Row): DatasetView => ({
  id: row.id,
  // The CHECK constraint holds kind to the import kinds.
  kind: isImportKind(row.kind) ? row.kind : "table",
  name: row.name,
  sourceFileName: row.sourceFileName,
  rowCount: row.rowCount,
  firstAt: row.firstAt,
  lastAt: row.lastAt,
  createdAt: row.createdAt.toISOString(),
});

/** Large tables write up to 200 chunks and 200,000 rows; the default 5 s is too short. */
const TRANSACTION_TIMEOUT_MS = 120_000;
/** Rows per `createMany`, well under Postgres's 65,535 bind parameters. */
const INSERT_BATCH = 2_000;

const batches = <T>(rows: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / INSERT_BATCH) }, (_, index) =>
    rows.slice(index * INSERT_BATCH, (index + 1) * INSERT_BATCH),
  );

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const save = async (plan: SavePlan): Promise<SaveOutcome> => {
  const { userId } = plan.dataset;
  try {
    const row = await database().$transaction(
      async (tx) => {
        const dataset = await tx.personalDataset.create({
          data: { ...plan.dataset, status: "ready" },
          select: SELECT,
        });
        const datasetId = dataset.id;
        for (const batch of batches(plan.observations)) {
          await tx.personalObservation.createMany({
            data: batch.map((row) => ({ ...row, datasetId, userId })),
          });
        }
        for (const batch of batches(plan.clinical)) {
          await tx.personalClinicalRecord.createMany({
            data: batch.map((row) => ({ ...row, datasetId, userId })),
          });
        }
        for (const batch of batches(plan.variants)) {
          await tx.personalVariant.createMany({
            data: batch.map((row) => ({ ...row, datasetId, userId })),
          });
        }
        if (plan.table !== null) {
          await tx.personalTable.create({
            data: {
              datasetId,
              userId,
              columns: plan.table.columns.map((column) => ({ ...column })),
              rowCount: plan.table.rowCount,
            },
          });
          for (const [chunkIndex, rows] of plan.chunks.entries()) {
            await tx.personalTableChunk.create({
              data: { datasetId, userId, chunkIndex, rows: rows.map((row) => [...row]) },
            });
          }
        }
        return dataset;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
    return { ok: true, dataset: toView(row) };
  } catch (error) {
    // Two saves of the same file racing: the unique (user_id, sha256) index decides.
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
};

export const personalDataStore = (): PersonalDataStore => ({
  list: async (userId) =>
    (
      await database().personalDataset.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      })
    ).map(toView),
  findBySha: async (userId, sha256) => {
    const row = await database().personalDataset.findUnique({
      where: { userId_sha256: { userId, sha256 } },
      select: SELECT,
    });
    return row === null ? null : toView(row);
  },
  save,
  rename: async (userId, id, name) => {
    const updated = await database().personalDataset.updateMany({
      where: { id, userId },
      data: { name },
    });
    if (updated.count === 0) return null;
    const row = await database().personalDataset.findFirst({
      where: { id, userId },
      select: SELECT,
    });
    return row === null ? null : toView(row);
  },
  remove: async (userId, id) =>
    database().$transaction(async (tx) => {
      const row = await tx.personalDataset.findFirst({
        where: { id, userId },
        select: { rowCount: true },
      });
      if (row === null) return null;
      // Cascades to observations, clinical records, variants, the table and its chunks.
      await tx.personalDataset.delete({ where: { id } });
      return row.rowCount;
    }),
});

const OBSERVATION_SELECT = {
  id: true,
  datasetId: true,
  code: true,
  display: true,
  value: true,
  unit: true,
  effectiveAt: true,
  effectivePrecision: true,
} as const;

const PRECISIONS: readonly EffectivePrecision[] = ["year", "month", "day", "instant"];

const toObservation = (
  row: Readonly<{
    id: string;
    datasetId: string;
    code: string | null;
    display: string;
    value: number;
    unit: string;
    effectiveAt: Date;
    effectivePrecision: string;
  }>,
): ImportedObservationRecord => ({
  ...row,
  // The CHECK constraint holds precision to these; anything else reads as the coarsest.
  effectivePrecision:
    PRECISIONS.find((precision) => precision === row.effectivePrecision) ?? "year",
});

/**
 * The chat tools' reads of one person's imported observations (#181,
 * `packages/query-tools/imported-tools.ts`). Bound to that person: `userId`
 * resolves the signed-in actor's row, and a person with no row has nothing.
 * Fixed `findMany` / `groupBy` only, each capped by the caller's `take`.
 * Coded reads are held to LOINC; a series by name is held to rows with no code.
 * A genome VCF is not listed at all: its rows are read only under
 * `permitGenomeRequest`, never by these tools.
 */
/** Kinds the imported-data chat tools may list: every one but a genome file. */
const CHAT_LISTED_KINDS: ImportKind[] = IMPORT_KINDS.filter(
  (kind) => !isGenomeImportKind(kind),
);

export const importedDataReads = (
  userId: () => Promise<string | null>,
): Omit<ImportedDataPorts, "appendAudit"> => {
  const withUser = async <T>(read: (id: string) => Promise<T>, none: T): Promise<T> => {
    const id = await userId();
    return id === null ? none : read(id);
  };
  return {
    listDatasets: () =>
      withUser(
        async (id) =>
          (
            await database().personalDataset.findMany({
              where: { userId: id, kind: { in: CHAT_LISTED_KINDS } },
              orderBy: { createdAt: "desc" },
              select: SELECT,
            })
          ).map(toView),
        [],
      ),
    listSeries: (take) =>
      withUser(async (id) => {
        const groups = await database().personalObservation.groupBy({
          by: ["datasetId", "codeSystem", "code", "display", "unit"],
          where: { userId: id },
          _count: { _all: true },
          _min: { effectiveAt: true },
          _max: { effectiveAt: true },
          orderBy: [
            { datasetId: "asc" },
            { codeSystem: "asc" },
            { code: "asc" },
            { display: "asc" },
            { unit: "asc" },
          ],
          take,
        });
        return groups.flatMap((group) =>
          group._min.effectiveAt === null || group._max.effectiveAt === null
            ? []
            : [
                {
                  datasetId: group.datasetId,
                  codeSystem: group.codeSystem,
                  code: group.code,
                  display: group.display,
                  unit: group.unit,
                  n: group._count._all,
                  firstAt: group._min.effectiveAt,
                  lastAt: group._max.effectiveAt,
                },
              ],
        );
      }, []),
    // One indexed `findFirst` per code (at most 20): Prisma's `distinct` would
    // read every row of the codes before keeping the first.
    findLatest: (query) =>
      withUser(async (id) => {
        const rows = await Promise.all(
          [...new Set(query.codes)].map((code) =>
            database().personalObservation.findFirst({
              where: {
                userId: id,
                codeSystem: LOINC_SYSTEM,
                code,
                ...(query.datasetId === null ? {} : { datasetId: query.datasetId }),
              },
              orderBy: [{ effectiveAt: "desc" }, { id: "asc" }],
              select: OBSERVATION_SELECT,
            }),
          ),
        );
        return rows.flatMap((row) => (row === null ? [] : [toObservation(row)]));
      }, []),
    findSeries: (query) =>
      withUser(
        async (id) =>
          (
            await database().personalObservation.findMany({
              where: {
                userId: id,
                datasetId: query.datasetId,
                ...(query.code !== null
                  ? { codeSystem: LOINC_SYSTEM, code: query.code }
                  : { code: null, display: query.name ?? "" }),
                effectiveAt: { gte: query.start, lte: query.end },
              },
              orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
              take: query.take,
              select: OBSERVATION_SELECT,
            })
          ).map(toObservation),
        [],
      ),
  };
};
