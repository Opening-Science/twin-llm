import "server-only";

import { database } from "@/infrastructure/database";
import { append, type AppendInput } from "@/packages/audit/append";

/**
 * What the query tools need from outside: one subject lookup, one fixed
 * observation query and the audit append. The defaults below are the only
 * Prisma calls the analytics tools make; tests pass in-memory functions, so
 * none of them has to fake a whole Prisma client or replace a module.
 */

export type SubjectScopeRow = Readonly<{ isSynthetic: boolean; cohortId: string }>;

export type ObservationRecord = Readonly<{
  loinc: string;
  value: number;
  unitUcum: string;
  effectiveAt: Date;
}>;

export type ObservationQuery = Readonly<{
  subjectRef: string;
  loinc: readonly string[];
  start: Date;
  end: Date;
  take: number;
}>;

export type QueryToolPorts = Readonly<{
  findSubject: (subjectRef: string) => Promise<SubjectScopeRow | null>;
  /** Rows ordered by `effectiveAt` ascending, at most `take`. */
  findObservations: (query: ObservationQuery) => Promise<readonly ObservationRecord[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value !== null && value !== undefined && typeof value === "object") {
    return Number(value.toString());
  }
  throw new Error("observation value is not numeric");
};

export const defaultQueryToolPorts = (): QueryToolPorts => ({
  findSubject: (subjectRef) =>
    database().subject.findUnique({
      where: { subjectRef },
      select: { isSynthetic: true, cohortId: true },
    }),
  findObservations: async (query) => {
    const rows = await database().observation.findMany({
      where: {
        subjectRef: query.subjectRef,
        loinc: { in: [...query.loinc] },
        effectiveAt: { gte: query.start, lte: query.end },
      },
      select: { loinc: true, value: true, unitUcum: true, effectiveAt: true },
      orderBy: { effectiveAt: "asc" },
      take: query.take,
    });
    return rows.map((row) => ({ ...row, value: toNumber(row.value) }));
  },
  appendAudit: (input) => append(database(), input),
});
