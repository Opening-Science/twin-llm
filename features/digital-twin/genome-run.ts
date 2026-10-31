import "server-only";

import { access } from "node:fs/promises";
import { join } from "node:path";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import type { GenomePermitDecision } from "@/infrastructure/data-mode-policy";
import { database } from "@/infrastructure/database";
import {
  CATEGORY,
  type Disclosure,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { genomeEnv } from "@/infrastructure/env";
import { genomeRunPermit } from "@/infrastructure/genome-gate";
import { personalReadEvent } from "@/infrastructure/personal-read-audit";
import {
  latestGenomeReport,
  saveGenomeReport,
  type NewGenomeReport,
  type StoredGenomeReport,
} from "@/infrastructure/genome-report-store";
import { append, type AppendInput } from "@/packages/audit/append";
import {
  appRun,
  dataList,
  isArkOk,
  type ArkAppRunData,
  type ArkAppRunInput,
  type ArkAuditContext,
  type ArkDataListDocument,
  type ArkResult,
} from "@/packages/ark-adapter";
import {
  parseRsidGenotypesReport,
  RSID_GENOTYPES_APP,
  RSID_GENOTYPES_GRANTS,
} from "@/packages/ark-adapter/rsid-genotypes";
import { GENOME_RUN_AUDIT_TOOL } from "@/packages/carbon-x/constants";

import {
  type GenomeReportPayload,
  type GenomeRunPayload,
  runFailure,
  toReportView,
} from "./genome-report-view";

/**
 * The genome dashboard's two routes.
 *
 * GET shows the stored report. POST runs rsid-genotypes on the Ark through
 * `packages/ark-adapter`: the CLI blocks until the owner approves on their
 * phone, then releases the report, which is parsed strictly and stored as a
 * personal record. Nothing here talks to a model. Every Ark call is audited
 * by the adapter; the store and every read of the stored report are audited
 * here with counts only, never a genotype or a hash of one. A report read
 * whose row cannot be written is not shown.
 *
 * A released report is a disclosure the other way (#140): the person's Ark
 * releases genome data into this machine. It is written to the disclosure
 * ledger as "received" after it parses and before it is stored; when that
 * write fails the report is not stored.
 */

/** Machine and network waits for one run; phone approval is on top (docs/ark.md). */
export const RUN_TIMEOUT_S = 30;

/** Where `bun run ark:build` writes the module, relative to the app's working directory. */
export const defaultRsidWasm = (): string =>
  join(process.cwd(), "apps/ark/rsid-genotypes/build/rsid-genotypes.wasm");

export type GenomeRunPorts = Readonly<{
  resolveActorId: () => Promise<string | null>;
  permit: () => GenomePermitDecision;
  assumeBuild: () => "GRCh38" | null;
  wasmPath: () => string;
  wasmExists: (path: string) => Promise<boolean>;
  dataList: (ctx: ArkAuditContext) => Promise<ArkResult<ArkDataListDocument>>;
  appRun: (
    ctx: ArkAuditContext,
    input: ArkAppRunInput,
  ) => Promise<ArkResult<ArkAppRunData>>;
  ensureUserId: (actor: string) => Promise<string>;
  latest: (actor: string) => Promise<StoredGenomeReport | null>;
  save: (input: NewGenomeReport) => Promise<StoredGenomeReport>;
  audit: (input: AppendInput) => Promise<unknown>;
  recordDisclosure: RecordDisclosure;
  sessionId: () => string;
}>;

const defaultPorts = (): GenomeRunPorts => ({
  resolveActorId,
  permit: genomeRunPermit,
  assumeBuild: () => genomeEnv().assumeBuild,
  wasmPath: () => genomeEnv().rsidGenotypesWasm ?? defaultRsidWasm(),
  wasmExists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  dataList,
  appRun,
  ensureUserId: async (actor) => (await ensureAppUser(actor)).id,
  latest: latestGenomeReport,
  save: saveGenomeReport,
  audit: (input) => append(database(), input),
  recordDisclosure,
  sessionId: () => crypto.randomUUID(),
});

/**
 * One report released from the Ark into this machine: the app, and the panel
 * sites it holds as references (rsIDs of the app's fixed panel, never a
 * genotype).
 */
export const arkReleaseDisclosure = (
  call: Readonly<{ actor: string; sessionId: string; rsids: readonly string[] }>,
): Disclosure => ({
  actor: call.actor,
  sessionId: call.sessionId,
  kind: "ark-release",
  direction: "received",
  recipient: "this machine, from the Ark",
  target: RSID_GENOTYPES_APP,
  purpose: "genome report",
  categories: [CATEGORY.genome],
  refs: call.rsids.map((rsid) => ({ source: "genome", key: rsid })),
  payloadBytes: null,
  threadId: null,
  synthetic: false,
});

/**
 * The build `ark data list` names for the small-variants slot (CLI 0.5.0,
 * e.g. GRCh38 or GRCh38.p14), else for the reference genome. Stored with the
 * report, so the GRCh38 check reads the Ark's word and GENOME_ASSUME_BUILD is
 * only a fallback for an Ark that names none. `snp-indel-calls` is the
 * CLI 0.3.5 name of the same slot.
 */
export const arkBuildOf = (listed: ArkDataListDocument): string | null => {
  const named = (slot: string) => {
    const build = listed.slots.find(
      (row) => String(row.slot) === slot || row.name === slot,
    )?.build;
    return typeof build === "string" && build.trim() !== "" ? build.trim() : null;
  };
  return named("small-variants") ?? named("snp-indel-calls") ?? named("reference-genome");
};

export const getGenomeReportResponse = async (
  overrides: Partial<GenomeRunPorts> = {},
): Promise<Response> => {
  const ports = { ...defaultPorts(), ...overrides };
  const actor = await ports.resolveActorId();
  if (!actor)
    return Response.json(
      { error: "Sign in to view the genome report." },
      { status: 401 },
    );
  if (!ports.permit().ok) {
    return Response.json({ enabled: false } satisfies GenomeReportPayload);
  }
  try {
    const stored = await ports.latest(actor);
    await ports.audit(
      personalReadEvent({
        actor,
        sessionId: ports.sessionId(),
        purpose: "genome-report",
        rowCount: stored?.rows.length ?? 0,
      }),
    );
    return Response.json({
      enabled: true,
      report: stored === null ? null : toReportView(stored, ports.assumeBuild()),
    } satisfies GenomeReportPayload);
  } catch (error) {
    console.error(
      "[genome] report read failed",
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json({ error: "Could not load the genome report." }, { status: 502 });
  }
};

const failed = (code: string, status = 200): Response =>
  Response.json(runFailure(code) satisfies GenomeRunPayload, { status });

export const postGenomeRunResponse = async (
  overrides: Partial<GenomeRunPorts> = {},
): Promise<Response> => {
  const ports = { ...defaultPorts(), ...overrides };
  const actor = await ports.resolveActorId();
  if (!actor) return failed("sign-in", 401);
  if (!ports.permit().ok) return failed("not-permitted", 403);

  const wasm = ports.wasmPath();
  if (!(await ports.wasmExists(wasm))) return failed("app-not-built", 409);

  const ctx: ArkAuditContext = { actor, sessionId: ports.sessionId() };
  const listed = await ports.dataList(ctx);
  if (!isArkOk(listed)) return failed(listed.status);

  const run = await ports.appRun(ctx, {
    app: wasm,
    grants: RSID_GENOTYPES_GRANTS,
    timeout: RUN_TIMEOUT_S,
  });
  if (!isArkOk(run)) return failed(run.status);

  const parsed = parseRsidGenotypesReport(run.data.report);
  const auditBase = {
    actor,
    sessionId: ctx.sessionId,
    subjectRef: null,
    tool: GENOME_RUN_AUDIT_TOOL,
    args: { app: RSID_GENOTYPES_APP, grants: RSID_GENOTYPES_GRANTS.length },
  } as const;
  if (!parsed.ok) {
    console.error("[genome] released report did not parse:", parsed.issue);
    await ports.audit({ ...auditBase, result: { stored: false }, rowCount: 0 });
    return failed("report-unreadable", 502);
  }

  const recorded = await ports
    .recordDisclosure(
      arkReleaseDisclosure({
        actor,
        sessionId: ctx.sessionId,
        rsids: parsed.rows.map((row) => row.rsid),
      }),
    )
    .then(
      () => true,
      (error: unknown) => {
        console.error(
          "[genome] the disclosure ledger could not be written",
          error instanceof Error ? error.name : "unknown",
        );
        return false;
      },
    );
  if (!recorded) return failed("not-recorded", 500);

  const arkBuild = arkBuildOf(listed.data);
  const stored = await ports.save({
    userId: await ports.ensureUserId(actor),
    arkBuild,
    rows: parsed.rows,
    report: run.data.report,
  });
  await ports.audit({
    ...auditBase,
    result: {
      stored: true,
      report_id: stored.id,
      rows: parsed.rows.length,
      calls: parsed.rows.filter((row) => row.genotype !== null).length,
      build_named: arkBuild !== null,
    },
    rowCount: parsed.rows.length,
  });
  return Response.json({
    ok: true,
    report: toReportView(stored, ports.assumeBuild()),
  } satisfies GenomeRunPayload);
};
