import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { CHUNK_ROWS } from "@/packages/personal-data/limits";
import type { SavePlan } from "@/packages/personal-data/save-plan";
import { storedColumns, storedRows } from "@/packages/personal-data/stored-table";
import {
  type EffectivePrecision,
  IMPORT_KINDS,
  isGenomeImportKind,
  isImportKind,
  type ImportKind,
} from "@/packages/personal-data/types";
import type {
  GenomeVariantPorts,
  GenomeVariantQuery,
} from "@/packages/query-tools/imported-variants";
import {
  type ImportedDataPorts,
  type ImportedObservationRecord,
  LOINC_SYSTEM,
} from "@/packages/query-tools/imported-ports";

import { database } from "./database";
import {
  type FieldCipher,
  newRowId,
  openNullable,
  openNumber,
  openJson,
  sealJson,
  sealNullable,
  sealNumber,
} from "./field-cipher";
import { cipherForUser } from "./field-cipher-runtime";
import {
  observationLookupValue,
  observationSeriesValue,
  variantIdsOf,
  variantSiteValue,
} from "./personal-columns";

/**
 * Reads and writes the personal_* tables: a person's imported files
 * (docs/personal-data.md). Every query is scoped to one `userId`, so one
 * person never reads, renames or deletes another's dataset. Callers check
 * the data-mode policy and write the audit row; this module only touches rows.
 *
 * Lives in infrastructure because two features need it: Customize · Data
 * imports and deletes, and the chat tools read it (`importedDataReads`).
 *
 * Personal columns are sealed with the owner's keys (#141, `field-cipher.ts`)
 * and opened after each read, so nothing here works while the owner's vault
 * is locked. Lookups use keyed hashes (`lookup_index`, `series_index`,
 * `site_index`, `variant_id_index`, `sha256_index`); sorting by a sealed
 * value happens in memory after opening.
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

const DATASETS = "personal_datasets";
const OBSERVATIONS = "personal_observations";
const CLINICAL = "personal_clinical_records";
const TABLES = "personal_tables";
const CHUNKS = "personal_table_chunks";
const VARIANTS = "personal_variants";

const toView =
  (cipher: FieldCipher) =>
  (row: Row): DatasetView => ({
    id: row.id,
    // The CHECK constraint holds kind to the import kinds.
    kind: isImportKind(row.kind) ? row.kind : "table",
    name: cipher.openText(DATASETS, "name", row.id, row.name),
    sourceFileName: cipher.openText(
      DATASETS,
      "source_file_name",
      row.id,
      row.sourceFileName,
    ),
    rowCount: row.rowCount,
    firstAt: openNullable(cipher, DATASETS, "first_at", row.id, row.firstAt),
    lastAt: openNullable(cipher, DATASETS, "last_at", row.id, row.lastAt),
    createdAt: row.createdAt.toISOString(),
  });

const shaLookups = (cipher: FieldCipher, sha256: string) =>
  cipher.indexes(DATASETS, "sha256", sha256);

const observationRow = (
  cipher: FieldCipher,
  ids: Readonly<{ datasetId: string; userId: string }>,
  row: SavePlan["observations"][number],
) => {
  const id = newRowId();
  const seal = (column: string, value: string) =>
    cipher.sealText(OBSERVATIONS, column, id, value);
  return {
    id,
    ...ids,
    codeSystem: sealNullable(cipher, OBSERVATIONS, "code_system", id, row.codeSystem),
    code: sealNullable(cipher, OBSERVATIONS, "code", id, row.code),
    display: seal("display", row.display),
    value: sealNumber(cipher, OBSERVATIONS, "value", id, row.value),
    unit: seal("unit", row.unit),
    unitUcum: row.unitUcum,
    effectiveAt: row.effectiveAt,
    effectivePrecision: row.effectivePrecision,
    sourceRef: seal("source_ref", row.sourceRef),
    note: sealNullable(cipher, OBSERVATIONS, "note", id, row.note),
    lookupIndex: cipher.index(
      OBSERVATIONS,
      "lookup",
      observationLookupValue(row.codeSystem, row.code, row.display),
    ),
    seriesIndex: cipher.index(
      OBSERVATIONS,
      "series",
      observationSeriesValue(row.codeSystem, row.code, row.display, row.unit),
    ),
  };
};

const clinicalRow = (
  cipher: FieldCipher,
  ids: Readonly<{ datasetId: string; userId: string }>,
  row: SavePlan["clinical"][number],
) => {
  const id = newRowId();
  return {
    id,
    ...ids,
    resourceType: row.resourceType,
    codeSystem: sealNullable(cipher, CLINICAL, "code_system", id, row.codeSystem),
    code: sealNullable(cipher, CLINICAL, "code", id, row.code),
    display: cipher.sealText(CLINICAL, "display", id, row.display),
    startAt: row.startAt,
    endAt: row.endAt,
    status: sealNullable(cipher, CLINICAL, "status", id, row.status),
    sourceRef: cipher.sealText(CLINICAL, "source_ref", id, row.sourceRef),
  };
};

const variantRow = (
  cipher: FieldCipher,
  ids: Readonly<{ datasetId: string; userId: string }>,
  row: SavePlan["variants"][number],
) => {
  const id = newRowId();
  const seal = (column: string, value: string) =>
    cipher.sealText(VARIANTS, column, id, value);
  return {
    id,
    ...ids,
    chrom: seal("chrom", row.chrom),
    pos: seal("pos", String(row.pos)),
    variantId: sealNullable(cipher, VARIANTS, "variant_id", id, row.variantId),
    ref: seal("ref", row.ref),
    alt: seal("alt", row.alt),
    genotype: sealNullable(cipher, VARIANTS, "genotype", id, row.genotype),
    filter: sealNullable(cipher, VARIANTS, "filter", id, row.filter),
    siteIndex: cipher.index(VARIANTS, "site", variantSiteValue(row.chrom, row.pos)),
    variantIdIndex: variantIdsOf(row.variantId).map((each) =>
      cipher.index(VARIANTS, "variant_id", each),
    ),
  };
};

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
  // Every value is sealed before the transaction opens: a write that cannot
  // encrypt is not made.
  const cipher = await cipherForUser(userId);
  const datasetId = newRowId();
  const ids = { datasetId, userId };
  const sealDataset = (column: string, value: string) =>
    cipher.sealText(DATASETS, column, datasetId, value);
  const datasetRow = {
    id: datasetId,
    userId,
    kind: plan.dataset.kind,
    name: sealDataset("name", plan.dataset.name),
    sourceFileName: sealDataset("source_file_name", plan.dataset.sourceFileName),
    sha256: sealDataset("sha256", plan.dataset.sha256),
    sha256Index: cipher.index(DATASETS, "sha256", plan.dataset.sha256),
    byteSize: plan.dataset.byteSize,
    rowCount: plan.dataset.rowCount,
    firstAt: sealNullable(cipher, DATASETS, "first_at", datasetId, plan.dataset.firstAt),
    lastAt: sealNullable(cipher, DATASETS, "last_at", datasetId, plan.dataset.lastAt),
    genomeBuild: plan.dataset.genomeBuild,
    status: "ready",
  };
  const observations = plan.observations.map((row) => observationRow(cipher, ids, row));
  const clinical = plan.clinical.map((row) => clinicalRow(cipher, ids, row));
  const variants = plan.variants.map((row) => variantRow(cipher, ids, row));
  const table =
    plan.table === null
      ? null
      : {
          datasetId,
          userId,
          columns: sealJson(
            cipher,
            TABLES,
            "columns",
            datasetId,
            plan.table.columns.map((column) => ({ ...column })),
          ),
          rowCount: plan.table.rowCount,
        };
  const chunks = plan.chunks.map((rows, chunkIndex) => {
    const id = newRowId();
    return {
      id,
      datasetId,
      userId,
      chunkIndex,
      rows: sealJson(cipher, CHUNKS, "rows", id, rows),
    };
  });
  try {
    const row = await database().$transaction(
      async (tx) => {
        const dataset = await tx.personalDataset.create({
          data: datasetRow,
          select: SELECT,
        });
        for (const batch of batches(observations)) {
          await tx.personalObservation.createMany({ data: batch });
        }
        for (const batch of batches(clinical)) {
          await tx.personalClinicalRecord.createMany({ data: batch });
        }
        for (const batch of batches(variants)) {
          await tx.personalVariant.createMany({ data: batch });
        }
        if (table !== null) {
          await tx.personalTable.create({ data: table });
          for (const chunk of chunks) {
            await tx.personalTableChunk.create({ data: chunk });
          }
        }
        return dataset;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
    return { ok: true, dataset: toView(cipher)(row) };
  } catch (error) {
    // Two saves of the same file racing: the unique (user_id, sha256) index decides.
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
};

export const personalDataStore = (): PersonalDataStore => ({
  list: async (userId) => {
    const cipher = await cipherForUser(userId);
    return (
      await database().personalDataset.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      })
    ).map(toView(cipher));
  },
  findBySha: async (userId, sha256) => {
    const cipher = await cipherForUser(userId);
    const row = await database().personalDataset.findFirst({
      where: { userId, sha256Index: { in: [...shaLookups(cipher, sha256)] } },
      select: SELECT,
    });
    return row === null ? null : toView(cipher)(row);
  },
  save,
  rename: async (userId, id, name) => {
    const cipher = await cipherForUser(userId);
    const updated = await database().personalDataset.updateMany({
      where: { id, userId },
      data: { name: cipher.sealText(DATASETS, "name", id, name) },
    });
    if (updated.count === 0) return null;
    const row = await database().personalDataset.findFirst({
      where: { id, userId },
      select: SELECT,
    });
    return row === null ? null : toView(cipher)(row);
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

const toObservation =
  (cipher: FieldCipher) =>
  (
    row: Readonly<{
      id: string;
      datasetId: string;
      code: string | null;
      display: string;
      value: string;
      unit: string;
      effectiveAt: Date;
      effectivePrecision: string;
    }>,
  ): ImportedObservationRecord => ({
    id: row.id,
    datasetId: row.datasetId,
    code: openNullable(cipher, OBSERVATIONS, "code", row.id, row.code),
    display: cipher.openText(OBSERVATIONS, "display", row.id, row.display),
    value: openNumber(cipher, OBSERVATIONS, "value", row.id, row.value),
    unit: cipher.openText(OBSERVATIONS, "unit", row.id, row.unit),
    effectiveAt: row.effectiveAt,
    // The CHECK constraint holds precision to these; anything else reads as the coarsest.
    effectivePrecision:
      PRECISIONS.find((precision) => precision === row.effectivePrecision) ?? "year",
  });

/** Ascending text order with nulls last, as Postgres sorts `ORDER BY ... ASC`. */
const compareNullable = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

const compareDate = (a: Date | null, b: Date | null): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.getTime() - b.getTime();
};

/** Conditions and medications: by date (none last), then name, then id. */
const byDateNameId =
  <T extends Readonly<{ id: string; display: string }>>(date: (row: T) => Date | null) =>
  (a: T, b: T): number =>
    compareDate(date(a), date(b)) ||
    compareNullable(a.display, b.display) ||
    compareNullable(a.id, b.id);

/**
 * The chat tools' reads of one person's imported observations (#181,
 * `packages/query-tools/imported-tools.ts`). Bound to that person: `userId`
 * resolves the signed-in actor's row, and a person with no row has nothing.
 * Fixed `findMany` / `groupBy` only, each capped by the caller's `take`.
 * Coded reads are held to LOINC; a series by name is held to rows with no code.
 * A genome VCF is not listed at all: its rows are read only under
 * `permitVcfVariantsRequest`, never by these tools.
 */
/** Kinds the imported-data chat tools may list: every one but a genome file. */
const CHAT_LISTED_KINDS: ImportKind[] = IMPORT_KINDS.filter(
  (kind) => !isGenomeImportKind(kind),
);

/** The genome kinds: an imported VCF. */
const GENOME_LISTED_KINDS: ImportKind[] = IMPORT_KINDS.filter(isGenomeImportKind);

export const importedDataReads = (
  userId: () => Promise<string | null>,
): Omit<ImportedDataPorts, "appendAudit"> => {
  const withUser = async <T>(
    read: (id: string, cipher: FieldCipher) => Promise<T>,
    none: T,
  ): Promise<T> => {
    const id = await userId();
    return id === null ? none : read(id, await cipherForUser(id));
  };
  return {
    listDatasets: () =>
      withUser(
        async (id, cipher) =>
          (
            await database().personalDataset.findMany({
              where: { userId: id, kind: { in: CHAT_LISTED_KINDS } },
              orderBy: { createdAt: "desc" },
              select: SELECT,
            })
          ).map(toView(cipher)),
        [],
      ),
    // Grouped by the keyed series hash in SQL; one row of each group is
    // opened to name it, then the groups are sorted as before and cut to `take`.
    listSeries: (take) =>
      withUser(async (id, cipher) => {
        const groups = await database().personalObservation.groupBy({
          by: ["datasetId", "seriesIndex"],
          where: { userId: id },
          _count: { _all: true },
          _min: { effectiveAt: true, id: true },
          _max: { effectiveAt: true },
        });
        const firstIds = groups.flatMap((group) =>
          group._min.id === null ? [] : [group._min.id],
        );
        const named = new Map(
          (
            await database().personalObservation.findMany({
              where: { userId: id, id: { in: firstIds } },
              select: {
                id: true,
                codeSystem: true,
                code: true,
                display: true,
                unit: true,
              },
            })
          ).map((row) => [
            row.id,
            {
              codeSystem: openNullable(
                cipher,
                OBSERVATIONS,
                "code_system",
                row.id,
                row.codeSystem,
              ),
              code: openNullable(cipher, OBSERVATIONS, "code", row.id, row.code),
              display: cipher.openText(OBSERVATIONS, "display", row.id, row.display),
              unit: cipher.openText(OBSERVATIONS, "unit", row.id, row.unit),
            },
          ]),
        );
        return groups
          .flatMap((group) => {
            const name = group._min.id === null ? undefined : named.get(group._min.id);
            return name === undefined ||
              group._min.effectiveAt === null ||
              group._max.effectiveAt === null
              ? []
              : [
                  {
                    datasetId: group.datasetId,
                    ...name,
                    n: group._count._all,
                    firstAt: group._min.effectiveAt,
                    lastAt: group._max.effectiveAt,
                  },
                ];
          })
          .sort(
            (a, b) =>
              compareNullable(a.datasetId, b.datasetId) ||
              compareNullable(a.codeSystem, b.codeSystem) ||
              compareNullable(a.code, b.code) ||
              compareNullable(a.display, b.display) ||
              compareNullable(a.unit, b.unit),
          )
          .slice(0, take);
      }, []),
    // One indexed `findFirst` per code (at most 20): Prisma's `distinct` would
    // read every row of the codes before keeping the first.
    findLatest: (query) =>
      withUser(async (id, cipher) => {
        const rows = await Promise.all(
          [...new Set(query.codes)].map((code) =>
            database().personalObservation.findFirst({
              where: {
                userId: id,
                lookupIndex: {
                  in: [
                    ...cipher.indexes(
                      OBSERVATIONS,
                      "lookup",
                      observationLookupValue(LOINC_SYSTEM, code, ""),
                    ),
                  ],
                },
                ...(query.datasetId === null ? {} : { datasetId: query.datasetId }),
              },
              orderBy: [{ effectiveAt: "desc" }, { id: "asc" }],
              select: OBSERVATION_SELECT,
            }),
          ),
        );
        return rows.flatMap((row) => (row === null ? [] : [toObservation(cipher)(row)]));
      }, []),
    findSeries: (query) =>
      withUser(
        async (id, cipher) =>
          (
            await database().personalObservation.findMany({
              where: {
                userId: id,
                datasetId: query.datasetId,
                lookupIndex: {
                  in: [
                    ...cipher.indexes(
                      OBSERVATIONS,
                      "lookup",
                      query.code !== null
                        ? observationLookupValue(LOINC_SYSTEM, query.code, "")
                        : observationLookupValue(null, null, query.name ?? ""),
                    ),
                  ],
                },
                effectiveAt: { gte: query.start, lte: query.end },
              },
              orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
              take: query.take,
              select: OBSERVATION_SELECT,
            })
          ).map(toObservation(cipher)),
        [],
      ),
    listTables: () =>
      withUser(
        async (id, cipher) =>
          (
            await database().personalTable.findMany({
              where: { userId: id },
              orderBy: { datasetId: "asc" },
              select: { datasetId: true, columns: true, rowCount: true },
            })
          ).map((table) => ({
            datasetId: table.datasetId,
            columns: storedColumns(
              openJson(cipher, TABLES, "columns", table.datasetId, table.columns),
            ),
            rowCount: table.rowCount,
          })),
        [],
      ),
    // Only the chunks that hold the first `take` rows are read.
    readTableRows: (query) =>
      withUser(async (id, cipher) => {
        const chunks = await database().personalTableChunk.findMany({
          where: {
            userId: id,
            datasetId: query.datasetId,
            chunkIndex: { lt: Math.ceil(query.take / CHUNK_ROWS) },
          },
          orderBy: { chunkIndex: "asc" },
          select: { id: true, rows: true },
        });
        return chunks
          .flatMap((chunk) =>
            storedRows(openJson(cipher, CHUNKS, "rows", chunk.id, chunk.rows)),
          )
          .slice(0, query.take);
      }, []),
    findConditions: (query) =>
      withUser(async (id, cipher) => {
        const rows = await database().personalClinicalRecord.findMany({
          where: { userId: id, datasetId: query.datasetId, resourceType: "Condition" },
          select: {
            id: true,
            codeSystem: true,
            code: true,
            display: true,
            startAt: true,
            endAt: true,
            status: true,
          },
        });
        return rows
          .map((row) => ({
            id: row.id,
            codeSystem: openNullable(
              cipher,
              CLINICAL,
              "code_system",
              row.id,
              row.codeSystem,
            ),
            code: openNullable(cipher, CLINICAL, "code", row.id, row.code),
            display: cipher.openText(CLINICAL, "display", row.id, row.display),
            onsetAt: row.startAt,
            abatementAt: row.endAt,
            status: openNullable(cipher, CLINICAL, "status", row.id, row.status),
          }))
          .sort(byDateNameId((row) => row.onsetAt))
          .slice(0, query.take);
      }, []),
    // Coded fields, authored date and status only: dosage text, notes and
    // reasons were never stored, and nothing else is selected.
    findMedications: (query) =>
      withUser(async (id, cipher) => {
        const rows = await database().personalClinicalRecord.findMany({
          where: {
            userId: id,
            datasetId: query.datasetId,
            resourceType: "MedicationRequest",
          },
          select: {
            id: true,
            codeSystem: true,
            code: true,
            display: true,
            startAt: true,
            status: true,
          },
        });
        return rows
          .map((row) => ({
            id: row.id,
            codeSystem: openNullable(
              cipher,
              CLINICAL,
              "code_system",
              row.id,
              row.codeSystem,
            ),
            code: openNullable(cipher, CLINICAL, "code", row.id, row.code),
            display: cipher.openText(CLINICAL, "display", row.id, row.display),
            authoredAt: row.startAt,
            status: openNullable(cipher, CLINICAL, "status", row.id, row.status),
          }))
          .sort(byDateNameId((row) => row.authoredAt))
          .slice(0, query.take);
      }, []),
  };
};

/** The lookup hashes of an rsID query and a site query, under every key of the keyring. */
export const variantLookups = (
  cipher: FieldCipher,
  query: Pick<GenomeVariantQuery, "rsids" | "sites">,
): Readonly<{ ids: readonly string[]; sites: readonly string[] }> => ({
  ids: query.rsids.flatMap((rsid) => cipher.indexes(VARIANTS, "variant_id", rsid)),
  sites: query.sites.flatMap((site) =>
    site.chroms.flatMap((chrom) =>
      cipher.indexes(VARIANTS, "site", variantSiteValue(chrom, site.pos)),
    ),
  ),
});

const compareVariant = (
  a: Readonly<{ chrom: string; pos: number; id: string }>,
  b: Readonly<{ chrom: string; pos: number; id: string }>,
): number =>
  compareNullable(a.chrom, b.chrom) || a.pos - b.pos || compareNullable(a.id, b.id);

/**
 * Has this person imported a VCF (#399)? A count over the plain `kind` column,
 * so nothing is opened and the vault may stay locked. The chat route asks it
 * only after the VCF permit holds, to leave `genome_variants` off a turn with
 * no VCF to read.
 */
export const hasImportedVcf = async (userId: string): Promise<boolean> =>
  (await database().personalDataset.count({
    where: { userId, kind: { in: GENOME_LISTED_KINDS } },
  })) > 0;

/**
 * The reads behind `genome_variants` (#307): the person's datasets, and the
 * records of one VCF that carry a named rsID or sit at a named site. Bound to
 * that person like `importedDataReads`. One fixed `findMany` over the keyed
 * hashes (#141), capped by the caller's `take` after sorting; the tool matches
 * each record to its name again. Callers check `permitVcfVariantsRequest`
 * (#330) first; nothing here decides who may read.
 */
export const genomeVariantReads = (
  userId: () => Promise<string | null>,
): Omit<GenomeVariantPorts, "appendAudit"> => ({
  listDatasets: async () => {
    const id = await userId();
    if (id === null) return [];
    const cipher = await cipherForUser(id);
    return (
      await database().personalDataset.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      })
    ).map(toView(cipher));
  },
  findVariants: async (query) => {
    const id = await userId();
    if (id === null) return [];
    const cipher = await cipherForUser(id);
    const lookups = variantLookups(cipher, query);
    const wanted = [
      ...(lookups.ids.length > 0
        ? [{ variantIdIndex: { hasSome: [...lookups.ids] } }]
        : []),
      ...(lookups.sites.length > 0 ? [{ siteIndex: { in: [...lookups.sites] } }] : []),
    ];
    if (wanted.length === 0) return [];
    const rows = await database().personalVariant.findMany({
      where: { userId: id, datasetId: query.datasetId, OR: wanted },
      select: {
        id: true,
        chrom: true,
        pos: true,
        variantId: true,
        ref: true,
        alt: true,
        genotype: true,
        filter: true,
      },
    });
    const open = (column: string, rowId: string, value: string) =>
      cipher.openText(VARIANTS, column, rowId, value);
    return rows
      .map((row) => ({
        id: row.id,
        chrom: open("chrom", row.id, row.chrom),
        pos: openNumber(cipher, VARIANTS, "pos", row.id, row.pos),
        variantId: openNullable(cipher, VARIANTS, "variant_id", row.id, row.variantId),
        ref: open("ref", row.id, row.ref),
        alt: open("alt", row.id, row.alt),
        genotype: openNullable(cipher, VARIANTS, "genotype", row.id, row.genotype),
        filter: openNullable(cipher, VARIANTS, "filter", row.id, row.filter),
      }))
      .sort(compareVariant)
      .slice(0, query.take)
      .map(({ id: _id, ...record }) => record);
  },
});
