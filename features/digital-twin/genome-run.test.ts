import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { Disclosure } from "@/infrastructure/disclosure-ledger";
import { personalReadEvent } from "@/infrastructure/personal-read-audit";
import type { AppendInput } from "@/packages/audit/append";
import type {
  NewGenomeReport,
  StoredGenomeReport,
} from "@/infrastructure/genome-report-store";
import type { ArkAppRunInput, ArkAuditContext } from "@/packages/ark-adapter";

import {
  arkBuildOf,
  getGenomeReportResponse,
  type GenomeRunPorts,
  postGenomeRunResponse,
} from "./genome-run";

const PRESENT = readFileSync(
  join(import.meta.dir, "../../apps/ark/rsid-genotypes/goldens/present.tsv"),
  "utf8",
);

/** `ark data list --json` as CLI 0.5.0 shapes it: `slot` is the name, `id` the number. */
const listed = (build: string | null) => ({
  slots: [
    {
      slot: "reference-genome",
      id: 1,
      name: "Reference genome",
      state: "filled",
      build: "GRCh38.p14",
    },
    { slot: "small-variants", id: 3, name: "Small variants", state: "filled", build },
  ],
});

type Recorder = {
  runs: ArkAppRunInput[];
  saved: NewGenomeReport[];
  audits: AppendInput[];
  contexts: ArkAuditContext[];
  disclosures: Disclosure[];
  /** "ledger" and "save", in order. */
  order: string[];
};

const fakePorts = (
  overrides: Partial<GenomeRunPorts> = {},
): { ports: Partial<GenomeRunPorts>; seen: Recorder } => {
  const seen: Recorder = {
    runs: [],
    saved: [],
    audits: [],
    contexts: [],
    disclosures: [],
    order: [],
  };
  const ports: Partial<GenomeRunPorts> = {
    resolveActorId: async () => "local",
    permit: () => ({ ok: true }),
    assumeBuild: () => null,
    wasmPath: () => "/repo/apps/ark/rsid-genotypes/build/rsid-genotypes.wasm",
    wasmExists: async () => true,
    sessionId: () => "session-1",
    dataList: async (ctx) => {
      seen.contexts.push(ctx);
      return { status: "ok", data: listed("GRCh38") };
    },
    appRun: async (_ctx, input) => {
      seen.runs.push(input);
      return { status: "ok", data: { report: PRESENT } };
    },
    ensureUserId: async () => "user-1",
    latest: async () => null,
    recordDisclosure: async (disclosure) => {
      seen.disclosures.push(disclosure);
      seen.order.push("ledger");
      return { seq: 1n, auditSeq: 1n };
    },
    save: async (input): Promise<StoredGenomeReport> => {
      seen.saved.push(input);
      seen.order.push("save");
      return {
        id: "report-1",
        app: "rsid-genotypes",
        arkBuild: input.arkBuild,
        rows: input.rows,
        releasedAt: "2026-10-27T09:00:00.000Z",
      };
    },
    audit: async (input) => {
      seen.audits.push(input);
      return undefined;
    },
    ...overrides,
  };
  return { ports, seen };
};

describe("POST /api/genome/run", () => {
  test("a released report is in the disclosure ledger as received, before it is stored (#140)", async () => {
    const { ports, seen } = fakePorts();
    await postGenomeRunResponse(ports);
    expect(seen.order).toEqual(["ledger", "save"]);
    expect(seen.disclosures).toEqual([
      {
        actor: "local",
        sessionId: "session-1",
        kind: "ark-release",
        direction: "received",
        recipient: "this machine, from the Ark",
        target: "rsid-genotypes",
        purpose: "genome report",
        categories: ["genome report"],
        refs: (seen.saved[0]?.rows ?? []).map((row) => ({
          source: "genome",
          key: row.rsid,
        })),
        payloadBytes: null,
        threadId: null,
        synthetic: false,
      },
    ]);
    expect(seen.disclosures[0]?.refs.length).toBe(11);
    expect(JSON.stringify(seen.disclosures)).not.toContain("A/G");
  });

  test("when the ledger cannot be written the report is not stored", async () => {
    const { ports, seen } = fakePorts({
      recordDisclosure: async () => {
        throw new Error("ledger down");
      },
    });
    const response = await postGenomeRunResponse(ports);
    expect(response.status).toBe(500);
    expect(((await response.json()) as { code: string }).code).toBe("not-recorded");
    expect(seen.saved).toEqual([]);
  });

  test("runs rsid-genotypes with the panel grants, stores and shows the report", async () => {
    const { ports, seen } = fakePorts();
    const response = await postGenomeRunResponse(ports);
    const body = (await response.json()) as {
      ok: boolean;
      report: {
        rows: { rsid: string; gene: string; allele: string; genotype: string }[];
      };
    };
    expect(response.status).toBe(200);
    expect(seen.runs).toEqual([
      {
        app: "/repo/apps/ark/rsid-genotypes/build/rsid-genotypes.wasm",
        grants: [
          "v1/genome/rsids/rs4244285",
          "v1/genome/rsids/rs4986893",
          "v1/genome/rsids/rs12248560",
          "v1/genome/rsids/rs1799853",
          "v1/genome/rsids/rs1057910",
          "v1/genome/rsids/rs3892097",
          "v1/genome/rsids/rs1065852",
          "v1/genome/rsids/rs4149056",
          "v1/genome/rsids/rs3918290",
          "v1/genome/rsids/rs1142345",
          "v1/genome/rsids/rs9923231",
        ],
        timeout: 30,
      },
    ]);
    expect(seen.saved[0]?.arkBuild).toBe("GRCh38");
    expect(seen.saved[0]?.report).toBe(PRESENT);
    expect(body.ok).toBe(true);
    expect(body.report.rows[0]).toEqual({
      rsid: "rs4244285",
      gene: "CYP2C19",
      allele: "*2",
      chromosome: "chr10",
      position: 94781859,
      reference: "G",
      genotype: "A/G",
      granted: true,
    } as never);
  });

  test("the store audit row has counts only, no genotype or report text", async () => {
    const { ports, seen } = fakePorts();
    await postGenomeRunResponse(ports);
    expect(seen.audits).toEqual([
      {
        actor: "local",
        sessionId: "session-1",
        subjectRef: null,
        tool: "genome.report.store",
        args: { app: "rsid-genotypes", grants: 11 },
        result: {
          stored: true,
          report_id: "report-1",
          rows: 11,
          calls: 11,
          build_named: true,
        },
        rowCount: 11,
      },
    ]);
    expect(JSON.stringify(seen.audits)).not.toContain("A/G");
  });

  test("a declined approval stores nothing and says so", async () => {
    const { ports, seen } = fakePorts({
      appRun: async () => ({
        status: "refused",
        error: { code: "approval-denied", message: "denied" },
      }),
    });
    const response = await postGenomeRunResponse(ports);
    expect(await response.json()).toEqual({
      ok: false,
      code: "refused",
      message: "You declined the run or the report on your phone; nothing was stored.",
    });
    expect(seen.saved).toEqual([]);
  });

  test("every 0.5.0 failure ends in its own sentence and stores nothing", async () => {
    const cases = [
      [
        "awaiting_approval",
        "approval-timeout",
        "Nobody answered on your phone in time (5 minutes to approve the run, 10 to release the report); nothing was stored.",
      ],
      [
        "outdated",
        "firmware-outdated",
        "Ark firmware too old: run `ark firmware update`.",
      ],
      [
        "undelivered",
        "approval-undelivered",
        "The request never reached your phone. Open Ark Companion and run again.",
      ],
      [
        "rejected",
        "ark",
        "The Ark refused to run the app, for example because no small variants are loaded. Nothing was asked on your phone.",
      ],
      ["app_failed", "app-failed", "The app failed on the Ark; nothing was stored."],
    ] as const;
    for (const [status, code, message] of cases) {
      const { ports, seen } = fakePorts({
        appRun: async () => ({ status, error: { code, message: "raw cli text" } }),
      });
      const body = await (await postGenomeRunResponse(ports)).json();
      expect(body).toEqual({ ok: false, code: status, message });
      expect(seen.saved).toEqual([]);
    }
  });

  test("a report with declined sites is stored; not granted rows count as no call", async () => {
    const declined = readFileSync(
      join(import.meta.dir, "../../apps/ark/rsid-genotypes/goldens/declined.tsv"),
      "utf8",
    );
    const { ports, seen } = fakePorts({
      appRun: async () => ({ status: "ok", data: { report: declined } }),
    });
    const body = (await (await postGenomeRunResponse(ports)).json()) as {
      report: { rows: { rsid: string; genotype: string | null; granted: boolean }[] };
    };
    expect(seen.audits[0]?.result).toEqual({
      stored: true,
      report_id: "report-1",
      rows: 11,
      calls: 9,
      build_named: true,
    });
    expect(body.report.rows.filter((row) => !row.granted).map((row) => row.rsid)).toEqual(
      ["rs1057910", "rs9923231"],
    );
  });

  test("a busy Ark asks to close the Hub tab", async () => {
    const { ports } = fakePorts({
      dataList: async () => ({
        status: "busy",
        error: { code: "device-busy", message: "busy" },
      }),
    });
    const body = (await (await postGenomeRunResponse(ports)).json()) as {
      message: string;
    };
    expect(body.message).toBe("The Ark is busy. Close the Ark Hub tab and run again.");
  });

  test("a released text that is not the report is refused and audited as not stored", async () => {
    const { ports, seen } = fakePorts({
      appRun: async () => ({ status: "ok", data: { report: "# Something else\n" } }),
    });
    const response = await postGenomeRunResponse(ports);
    expect(response.status).toBe(502);
    expect(seen.saved).toEqual([]);
    expect(seen.audits.map((row) => row.result)).toEqual([{ stored: false }]);
  });

  test("not built, not permitted, not signed in: no Ark call at all", async () => {
    const cases: readonly [Partial<GenomeRunPorts>, number, string][] = [
      [{ wasmExists: async () => false }, 409, "app-not-built"],
      [
        {
          permit: () => ({
            ok: false,
            code: "GENOME_NOT_PERMITTED",
            reason: "data-mode-not-personal",
          }),
        },
        403,
        "not-permitted",
      ],
      [{ resolveActorId: async () => null }, 401, "sign-in"],
    ];
    for (const [override, status, code] of cases) {
      const { ports, seen } = fakePorts(override);
      const response = await postGenomeRunResponse(ports);
      expect([
        response.status,
        ((await response.json()) as { code: string }).code,
      ]).toEqual([status, code]);
      expect([seen.contexts.length, seen.runs.length]).toEqual([0, 0]);
    }
  });
});

describe("GET /api/genome/report", () => {
  test("off unless the genome run is permitted", async () => {
    const { ports } = fakePorts({
      permit: () => ({
        ok: false,
        code: "GENOME_NOT_PERMITTED",
        reason: "genome-source-not-ark",
      }),
    });
    expect(await (await getGenomeReportResponse(ports)).json()).toEqual({
      enabled: false,
    });
  });

  test("enabled with no stored report yet", async () => {
    const { ports, seen } = fakePorts();
    expect(await (await getGenomeReportResponse(ports)).json()).toEqual({
      enabled: true,
      report: null,
    });
    expect(seen.audits).toEqual([
      personalReadEvent({
        actor: "local",
        sessionId: "session-1",
        purpose: "genome-report",
        rowCount: 0,
      }),
    ]);
  });

  test("off: nothing is read, so no row is written", async () => {
    const { ports, seen } = fakePorts({
      permit: () => ({
        ok: false,
        code: "GENOME_NOT_PERMITTED",
        reason: "genome-source-not-ark",
      }),
      latest: async () => {
        throw new Error("must not read");
      },
    });
    expect((await getGenomeReportResponse(ports)).status).toBe(200);
    expect(seen.audits).toEqual([]);
  });

  test("a stored report read writes one row with its row count, no genotype", async () => {
    const { ports, seen } = fakePorts({
      latest: async () => ({
        id: "report-1",
        app: "rsid-genotypes",
        arkBuild: "GRCh38",
        rows: [
          {
            rsid: "rs0000001",
            chromosome: null,
            position: null,
            reference: null,
            genotype: "AG",
          },
          {
            rsid: "rs0000002",
            chromosome: null,
            position: null,
            reference: null,
            genotype: null,
          },
        ],
        releasedAt: "2026-10-27T09:00:00.000Z",
      }),
    });
    expect((await getGenomeReportResponse(ports)).status).toBe(200);
    expect(seen.audits).toEqual([
      personalReadEvent({
        actor: "local",
        sessionId: "session-1",
        purpose: "genome-report",
        rowCount: 2,
      }),
    ]);
    expect(JSON.stringify(seen.audits)).not.toContain("rs0000001");
  });

  test("when the read row cannot be written, the report is not shown", async () => {
    const { ports } = fakePorts({
      audit: async () => {
        throw new Error("audit-down");
      },
    });
    const response = await getGenomeReportResponse(ports);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not load the genome report." });
  });

  test("a stored report without a named build says windows are refused", async () => {
    const { ports } = fakePorts({
      latest: async () => ({
        id: "report-1",
        app: "rsid-genotypes",
        arkBuild: null,
        rows: [],
        releasedAt: "2026-10-27T09:00:00.000Z",
      }),
    });
    const body = (await (await getGenomeReportResponse(ports)).json()) as {
      report: { buildNote: string };
    };
    expect(body.report.buildNote).toBe(
      "The Ark named no build, so Carbon-X windows are refused",
    );
  });
});

describe("arkBuildOf", () => {
  test("the small-variants build first, then the reference slot's", () => {
    expect(arkBuildOf(listed("hg38"))).toBe("hg38");
    expect(arkBuildOf(listed(null))).toBe("GRCh38.p14");
    expect(arkBuildOf({ slots: [] })).toBe(null);
  });

  test("still reads a CLI 0.3.5 list, where the call slot was snp-indel-calls", () => {
    expect(
      arkBuildOf({
        slots: [{ slot: 3, name: "snp-indel-calls", state: "filled", build: "GRCh38" }],
      }),
    ).toBe("GRCh38");
  });
});
