import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { append } from "@/packages/audit/append";
import type {
  GbdCatalog,
  GbdEstimatePorts,
  GbdImportSource,
  GbdEstimateQuery,
  GbdStoredEstimate,
} from "@/packages/query-tools/gbd-estimate";

import { GBD_LOCAL_RELEASE } from "./constants";
import type { GbdImportStore } from "./import-chunks";
import { gbdRowKey } from "./results-csv";
import {
  GBD_STORE_BATCH,
  type GbdFileImport,
  type GbdImportOutcome,
  type GbdImportView,
} from "./store-types";

export {
  GBD_STORE_BATCH,
  type GbdFileImport,
  type GbdImportOutcome,
  type GbdImportView,
} from "./store-types";

/**
 * The local GBD store in Postgres (`gbd_imports`, `gbd_estimates`). Reads for
 * `gbd_estimate`, and the writes `bun run gbd:import` and Customize · Data
 * use (#426). Nothing here talks
 * to anything but the local database.
 */

const named = (
  rows: readonly Readonly<{ id: number | null; name: string | null }>[],
): GbdCatalog["locations"] =>
  rows
    .filter(
      (row): row is { id: number; name: string } => row.id !== null && row.name !== null,
    )
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.id - b.id);

export const gbdCatalog = async (db: PrismaClient): Promise<GbdCatalog> => {
  const [locations, causes, risks, ages] = await Promise.all([
    db.gbdEstimate.groupBy({ by: ["locationId", "locationName"] }),
    db.gbdEstimate.groupBy({
      by: ["causeId", "causeName"],
      where: { causeId: { not: null } },
    }),
    db.gbdEstimate.groupBy({ by: ["reiId", "reiName"], where: { reiId: { not: null } } }),
    db.gbdEstimate.groupBy({ by: ["ageId"] }),
  ]);
  return {
    locations: named(
      locations.map((row) => ({ id: row.locationId, name: row.locationName })),
    ),
    causes: named(causes.map((row) => ({ id: row.causeId, name: row.causeName }))),
    risks: named(risks.map((row) => ({ id: row.reiId, name: row.reiName }))),
    ages: ages.map((row) => row.ageId).sort((a, b) => a - b),
  };
};

export const findGbdEstimates = async (
  db: PrismaClient,
  query: GbdEstimateQuery,
): Promise<readonly GbdStoredEstimate[]> =>
  db.gbdEstimate.findMany({
    where: {
      measureId: query.measureId,
      metricId: query.metricId,
      sexId: query.sexId,
      ageId: query.ageId,
      year: { in: [...query.years] },
      locationId: { in: [...query.locationIds] },
      causeId: query.causeId,
      reiId: query.reiId,
    },
    select: {
      locationId: true,
      locationName: true,
      year: true,
      val: true,
      upper: true,
      lower: true,
    },
    orderBy: [{ year: "asc" }, { locationId: "asc" }],
    take: query.take,
  });

/** The latest import's day and the latest citation an import recorded (#417). */
export const gbdImportSource = async (db: PrismaClient): Promise<GbdImportSource> => {
  const [latest, cited] = await Promise.all([
    db.gbdImport.findFirst({
      orderBy: { importedAt: "desc" },
      select: { importedAt: true },
    }),
    db.gbdImport.findFirst({
      where: { citation: { not: null } },
      orderBy: { importedAt: "desc" },
      select: { citation: true },
    }),
  ]);
  return {
    importedOn: latest === null ? null : latest.importedAt.toISOString().slice(0, 10),
    citation: cited?.citation ?? null,
  };
};

/** True once any GBD estimate is stored: the chat offers `gbd_estimate` only then. */
export const hasGbdEstimates = async (db: PrismaClient): Promise<boolean> =>
  (await db.gbdEstimate.findFirst({ select: { key: true } })) !== null;

export const gbdEstimatePorts = (db: () => PrismaClient): GbdEstimatePorts => ({
  catalog: () => gbdCatalog(db()),
  findEstimates: (query) => findGbdEstimates(db(), query),
  appendAudit: (input) => append(db(), input),
  importSource: () => gbdImportSource(db()),
});

/**
 * The store as `importGbdChunks` (import-chunks.ts) uses it, one file at a
 * time: `known` before reading, `begin` once rows are ready, `addRows` per
 * batch, then `finish`, or `abort` to drop the file's record and every row
 * it brought.
 */
export const gbdImportStore = (db: PrismaClient): GbdImportStore => ({
  known: async (sha256) =>
    (await db.gbdImport.findUnique({ where: { sha256 }, select: { sha256: true } })) !==
    null,
  begin: async (file) => {
    await db.gbdImport.create({
      data: {
        sha256: file.sha256,
        fileName: file.fileName,
        release: GBD_LOCAL_RELEASE,
        rowCount: 0,
        newRows: 0,
        citation: file.citation ?? null,
      },
    });
  },
  addRows: async (sha256, rows) => {
    let added = 0;
    for (let start = 0; start < rows.length; start += GBD_STORE_BATCH) {
      const created = await db.gbdEstimate.createMany({
        data: rows
          .slice(start, start + GBD_STORE_BATCH)
          .map((row) => ({ key: gbdRowKey(row), importSha: sha256, ...row })),
        skipDuplicates: true,
      });
      added += created.count;
    }
    return added;
  },
  finish: async (sha256, counts) => {
    await db.gbdImport.update({ where: { sha256 }, data: counts });
  },
  abort: async (sha256) => {
    await db.gbdImport.deleteMany({ where: { sha256 } });
  },
});

/**
 * Stores one parsed file. A file whose checksum is already recorded is
 * skipped. An estimate another file already brought is kept as it was and
 * not counted as new. If a write fails, the file's record and rows go.
 */
export const importGbdFile = async (
  db: PrismaClient,
  file: GbdFileImport,
): Promise<GbdImportOutcome> => {
  const store = gbdImportStore(db);
  if (await store.known(file.sha256)) {
    return { kind: "already-imported", sha256: file.sha256 };
  }
  await store.begin(file);
  try {
    const newRows = await store.addRows(file.sha256, file.rows);
    await store.finish(file.sha256, { rowCount: file.rows.length, newRows });
    return { kind: "imported", sha256: file.sha256, rowCount: file.rows.length, newRows };
  } catch (error: unknown) {
    await store.abort(file.sha256);
    throw error;
  }
};

/** Every imported file, newest first, with the estimates each holds. */
export const listGbdImports = async (
  db: PrismaClient,
): Promise<readonly GbdImportView[]> => {
  const [imports, counts] = await Promise.all([
    db.gbdImport.findMany({ orderBy: { importedAt: "desc" } }),
    db.gbdEstimate.groupBy({ by: ["importSha"], _count: { _all: true } }),
  ]);
  const stored = new Map(counts.map((row) => [row.importSha, row._count._all]));
  return imports.map((row) => ({
    sha256: row.sha256,
    fileName: row.fileName,
    release: row.release,
    rowCount: row.rowCount,
    newRows: row.newRows,
    importedAt: row.importedAt.toISOString(),
    citation: row.citation,
    storedRows: stored.get(row.sha256) ?? 0,
  }));
};

/** Deletes one file's record and the estimates it brought; null when unknown. */
export const deleteGbdImport = async (
  db: PrismaClient,
  sha256: string,
): Promise<number | null> =>
  db.$transaction(async (tx) => {
    const known = await tx.gbdImport.findUnique({ where: { sha256 } });
    if (known === null) return null;
    const { count } = await tx.gbdEstimate.deleteMany({ where: { importSha: sha256 } });
    await tx.gbdImport.delete({ where: { sha256 } });
    return count;
  });
