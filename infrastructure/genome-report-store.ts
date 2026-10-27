import "server-only";

import { z } from "zod";

import {
  RSID_GENOTYPES_APP,
  type RsidGenotypeRow,
} from "@/packages/ark-adapter/rsid-genotypes";

import { database } from "./database";

/**
 * The released Ark report, stored locally so the dashboard and the genome
 * chat tools read it without asking the Ark (and the owner's phone) again.
 *
 * Two features read it (the Digital Twin dashboard writes and shows it; chat
 * reads it for `genome_report` and `dna_ask`), so it lives here. Callers gate
 * on the genome policy first; this module only reads and writes rows.
 */

export type StoredGenomeReport = Readonly<{
  id: string;
  app: string;
  arkBuild: string | null;
  rows: readonly RsidGenotypeRow[];
  releasedAt: string;
}>;

const rowSchema = z.object({
  rsid: z.string(),
  chromosome: z.string().nullable(),
  position: z.number().int().positive().nullable(),
  reference: z.string().nullable(),
  genotype: z.string().nullable(),
});

const rowsSchema = z.array(rowSchema);

/** The newest rsid-genotypes report of a signed-in actor (`User.clerkId`), or null. */
export const latestGenomeReport = async (
  clerkId: string,
): Promise<StoredGenomeReport | null> => {
  const row = await database().genomeReport.findFirst({
    where: { app: RSID_GENOTYPES_APP, user: { clerkId } },
    orderBy: { releasedAt: "desc" },
    select: { id: true, app: true, arkBuild: true, rows: true, releasedAt: true },
  });
  if (row === null) return null;
  const rows = rowsSchema.safeParse(row.rows);
  if (!rows.success) {
    console.error("[genome] stored report rows do not parse", row.id);
    return null;
  }
  return {
    id: row.id,
    app: row.app,
    arkBuild: row.arkBuild,
    rows: rows.data,
    releasedAt: row.releasedAt.toISOString(),
  };
};

export type NewGenomeReport = Readonly<{
  userId: string;
  arkBuild: string | null;
  rows: readonly RsidGenotypeRow[];
  report: string;
}>;

export const saveGenomeReport = async (
  input: NewGenomeReport,
): Promise<StoredGenomeReport> => {
  const row = await database().genomeReport.create({
    data: {
      userId: input.userId,
      app: RSID_GENOTYPES_APP,
      arkBuild: input.arkBuild,
      rows: input.rows.map((entry) => ({ ...entry })),
      report: input.report,
    },
    select: { id: true, app: true, arkBuild: true, releasedAt: true },
  });
  return {
    id: row.id,
    app: row.app,
    arkBuild: row.arkBuild,
    rows: input.rows,
    releasedAt: row.releasedAt.toISOString(),
  };
};
