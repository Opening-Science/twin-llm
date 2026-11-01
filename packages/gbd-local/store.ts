import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { append } from "@/packages/audit/append";
import type {
  GbdCatalog,
  GbdEstimatePorts,
  GbdEstimateQuery,
  GbdStoredEstimate,
} from "@/packages/query-tools/gbd-estimate";

import { GBD_LOCAL_RELEASE } from "./constants";
import { gbdRowKey, type GbdCsvRow } from "./results-csv";

/**
 * The local GBD store in Postgres (`gbd_imports`, `gbd_estimates`). Reads for
 * `gbd_estimate`, and the write `bun run gbd:import` uses. Nothing here talks
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

/** True once any GBD estimate is stored: the chat offers `gbd_estimate` only then. */
export const hasGbdEstimates = async (db: PrismaClient): Promise<boolean> =>
  (await db.gbdEstimate.findFirst({ select: { key: true } })) !== null;

export const gbdEstimatePorts = (db: () => PrismaClient): GbdEstimatePorts => ({
  catalog: () => gbdCatalog(db()),
  findEstimates: (query) => findGbdEstimates(db(), query),
  appendAudit: (input) => append(db(), input),
});

export type GbdFileImport = Readonly<{
  sha256: string;
  fileName: string;
  rows: readonly GbdCsvRow[];
}>;

export type GbdImportOutcome =
  | Readonly<{ kind: "already-imported"; sha256: string }>
  | Readonly<{ kind: "imported"; sha256: string; rowCount: number; newRows: number }>;

const BATCH = 5_000;

/**
 * Stores one parsed file. A file whose checksum is already recorded is
 * skipped. An estimate another file already brought is kept as it was and
 * not counted as new. If a write fails, the file's record and rows go.
 */
export const importGbdFile = async (
  db: PrismaClient,
  file: GbdFileImport,
): Promise<GbdImportOutcome> => {
  const known = await db.gbdImport.findUnique({ where: { sha256: file.sha256 } });
  if (known !== null) return { kind: "already-imported", sha256: file.sha256 };
  await db.gbdImport.create({
    data: {
      sha256: file.sha256,
      fileName: file.fileName,
      release: GBD_LOCAL_RELEASE,
      rowCount: file.rows.length,
      newRows: 0,
    },
  });
  try {
    let newRows = 0;
    for (let start = 0; start < file.rows.length; start += BATCH) {
      const batch = file.rows.slice(start, start + BATCH);
      const created = await db.gbdEstimate.createMany({
        data: batch.map((row) => ({
          key: gbdRowKey(row),
          importSha: file.sha256,
          ...row,
        })),
        skipDuplicates: true,
      });
      newRows += created.count;
    }
    await db.gbdImport.update({ where: { sha256: file.sha256 }, data: { newRows } });
    return { kind: "imported", sha256: file.sha256, rowCount: file.rows.length, newRows };
  } catch (error: unknown) {
    await db.gbdImport.delete({ where: { sha256: file.sha256 } });
    throw error;
  }
};
