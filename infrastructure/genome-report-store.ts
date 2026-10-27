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
  /** rsid-genotypes 0.2.0: false when the site's optional grant was not mounted. */
  granted: z.boolean().optional(),
});

const rowsSchema = z.array(rowSchema);

/** The newest rsid-genotypes report of a signed-in actor (`User.clerkId`), or null. */
export const latestGenomeReport = async (
  clerkId: string,
): Promise<StoredGenomeReport | null> => {
  const row = await database().genomeReport.findFirst({
    where: { app: RSID_GENOTYPES_APP, isSynthetic: false, user: { clerkId } },
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

export type NewSyntheticGenomeReport = Readonly<{
  subjectRef: string;
  arkBuild: string | null;
  rows: readonly RsidGenotypeRow[];
  report: string;
}>;

export type SyntheticSaveResult = "saved" | "no_subject" | "not_synthetic";

/**
 * A synthetic subject's report (`scripts/genome-synth`), flagged synthetic and
 * tied to the warehouse subject instead of a user. Refuses a subject that is
 * not in the warehouse or not synthetic, so a person's data can never be
 * written this way. Replaces the subject's earlier synthetic report, so a
 * re-run does not add rows.
 */
export const replaceSyntheticGenomeReport = async (
  input: NewSyntheticGenomeReport,
  allowedCohort: (cohortId: string) => boolean,
): Promise<SyntheticSaveResult> => {
  const subject = await database().subject.findUnique({
    where: { subjectRef: input.subjectRef },
    select: { isSynthetic: true, cohortId: true },
  });
  if (subject === null) return "no_subject";
  if (!subject.isSynthetic || !allowedCohort(subject.cohortId)) return "not_synthetic";
  await database().$transaction([
    database().genomeReport.deleteMany({
      where: { subjectRef: input.subjectRef, app: RSID_GENOTYPES_APP, isSynthetic: true },
    }),
    database().genomeReport.create({
      data: {
        subjectRef: input.subjectRef,
        isSynthetic: true,
        app: RSID_GENOTYPES_APP,
        arkBuild: input.arkBuild,
        rows: input.rows.map((entry) => ({ ...entry })),
        report: input.report,
      },
      select: { id: true },
    }),
  ]);
  return "saved";
};
