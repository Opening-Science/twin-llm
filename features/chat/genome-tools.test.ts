import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import type { StoredGenomeReport } from "@/infrastructure/genome-report-store";
import type { AppendInput } from "@/packages/audit/append";
import type { RsidGenotypeRow } from "@/packages/ark-adapter/rsid-genotypes";
import { askCarbonX } from "@/packages/carbon-x/client";
import { startFakeCarbonX } from "@/packages/carbon-x/fake-carbon-x";
import { referenceWindows } from "@/packages/genome-reference";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { createChatTools } from "./chat-tools";
import { type GenomeToolDeps, runDnaAsk, runGenomeReport } from "./genome-tools";

const FIXTURES = join(import.meta.dir, "../../packages/genome-reference/fixtures");
/** The synthetic chr10 fixture's bases; position 65 is an A. */
const SEQUENCE = readFileSync(join(FIXTURES, "chr10.fa"), "utf8")
  .split("\n")
  .slice(1)
  .join("")
  .toUpperCase();

const row = (overrides: Partial<RsidGenotypeRow>): RsidGenotypeRow => ({
  rsid: "rs4244285",
  chromosome: "chr10",
  position: 65,
  reference: "A",
  genotype: "A/G",
  ...overrides,
});

const report = (
  rows: readonly RsidGenotypeRow[],
  arkBuild: string | null = "GRCh38",
): StoredGenomeReport => ({
  id: "report-1",
  app: "rsid-genotypes",
  arkBuild,
  rows,
  releasedAt: "2026-10-27T09:00:00.000Z",
});

const PERSONAL = { actor: "local", sessionId: "turn-1", mode: "personal" } as const;

const carbonX = await startFakeCarbonX({
  answer:
    "The G allele sits in a splice region and is reported to reduce enzyme activity. Patients should take a lower dose.",
});
afterAll(() => carbonX.stop());

const depsWith = (
  stored: StoredGenomeReport | null,
  overrides: Partial<GenomeToolDeps> = {},
): { deps: GenomeToolDeps; audits: AppendInput[] } => {
  const audits: AppendInput[] = [];
  return {
    audits,
    deps: {
      scope: PERSONAL,
      loadReport: async () => stored,
      assumeBuild: null,
      windows: (request) => referenceWindows(FIXTURES, request),
      ask: (messages) =>
        askCarbonX({ baseUrl: carbonX.baseUrl, timeoutMs: 2000 }, messages),
      appendAudit: async (input) => {
        audits.push(input);
        return undefined;
      },
      flank: 8,
      ...overrides,
    },
  };
};

describe("dna_ask", () => {
  test("public reference windows plus the genotype go to Carbon-X; the answer comes back labelled", async () => {
    const { deps, audits } = depsWith(report([row({})]));
    const before = carbonX.received.length;
    const output = await runDnaAsk(deps, { rsid: "rs4244285" });
    expect(output).toEqual({
      source: "Carbon-X (research model)",
      rsid: "rs4244285",
      gene: "CYP2C19",
      allele: "*2",
      site: "chr10:65 (GRCh38)",
      genotype: "A/G",
      answer:
        "The G allele sits in a splice region and is reported to reduce enzyme activity.\n\n[A sentence about dosing or medicine changes was withheld: Carbon-X is a research model.]",
      withheld_sentences: 1,
      note: "Research model output about a DNA sequence. Not clinical advice and not a basis for any dosing or medicine decision.",
    });
    const sent = carbonX.received.slice(before);
    expect(sent.length).toBe(1);
    const user = sent[0]?.messages[1]?.content ?? "";
    expect(user).toContain(`<dna>${SEQUENCE.slice(56, 73)}</dna>`);
    expect(user).toContain(
      `<dna>${SEQUENCE.slice(56, 64)}G${SEQUENCE.slice(65, 73)}</dna>`,
    );
    expect(user).toContain("Recorded genotype: A/G.");
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn-1",
        subjectRef: null,
        tool: "genome.dna_ask",
        args: { rsid: "rs4244285", report_id: "report-1", flank: 8, build: "GRCh38" },
        result: { answered: true, answer_chars: 170, withheld: 1 },
        rowCount: 1,
      },
    ]);
  });

  test("no audit row carries a genotype or a hash of one", async () => {
    const { deps, audits } = depsWith(report([row({})]));
    await runDnaAsk(deps, { rsid: "rs4244285" });
    expect(JSON.stringify(audits)).not.toMatch(/A\/G|"genotype"|sha256/);
  });

  const refusedCases: readonly [
    string,
    StoredGenomeReport | null,
    Partial<GenomeToolDeps>,
    string,
  ][] = [
    ["no report", null, {}, "NO_REPORT"],
    [
      "rsid not in report",
      report([row({ rsid: "rs4986893" })]),
      {},
      "RSID_NOT_IN_REPORT",
    ],
    ["no call", report([row({ genotype: null })]), {}, "NO_CALL"],
    ["no position", report([row({ position: null })]), {}, "INCOMPLETE_ROW"],
    ["GRCh37 report", report([row({})], "GRCh37"), {}, "BUILD_MISMATCH"],
    ["build unknown", report([row({})], null), {}, "BUILD_UNKNOWN"],
    ["ref mismatch", report([row({ reference: "C" })]), {}, "REF_MISMATCH"],
    ["other strand", report([row({ reference: "T" })]), {}, "REF_STRAND_MISMATCH"],
    [
      "no reference set up",
      report([row({})]),
      { windows: (request) => referenceWindows(null, request) },
      "REFERENCE_NOT_CONFIGURED",
    ],
    [
      "Carbon-X down",
      report([row({})]),
      {
        ask: (messages) =>
          askCarbonX({ baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 500 }, messages),
      },
      "CARBON_X_UNREACHABLE",
    ],
  ];

  for (const [name, stored, overrides, code] of refusedCases) {
    test(`refuses: ${name}`, async () => {
      const { deps, audits } = depsWith(stored, overrides);
      const before = carbonX.received.length;
      const output = await runDnaAsk(deps, { rsid: "rs4244285" });
      expect("code" in output ? output.code : "answered").toBe(code);
      expect(audits.map((entry) => [entry.tool, entry.result, entry.rowCount])).toEqual([
        ["genome.dna_ask", { code }, 0],
      ]);
      if (code !== "CARBON_X_UNREACHABLE") expect(carbonX.received.length).toBe(before);
    });
  }

  test("an assumed GRCh38 build is used only when the Ark named none", async () => {
    const { deps } = depsWith(report([row({})], null), { assumeBuild: "GRCh38" });
    const output = await runDnaAsk(deps, { rsid: "rs4244285" });
    expect("answer" in output).toBe(true);
  });

  test("a synthetic scope is refused before anything is read", async () => {
    const reads: string[] = [];
    const { deps, audits } = depsWith(report([row({})]), {
      scope: { ...PERSONAL, mode: "synthetic" },
      loadReport: async () => {
        reads.push("report");
        return null;
      },
    });
    expect(await runDnaAsk(deps, { rsid: "rs4244285" })).toEqual({
      code: "GENOME_NOT_PERMITTED",
      error: "genome tools run only in personal data mode on this machine",
    });
    expect([reads, audits]).toEqual([[], []]);
  });
});

describe("genome_report", () => {
  test("rows with gene context; no call stays no call; audit has counts only", async () => {
    const { deps, audits } = depsWith(
      report([row({}), row({ rsid: "rs4986893", genotype: null })]),
    );
    const output = await runGenomeReport(deps);
    if ("code" in output) throw new Error(output.error);
    expect(
      output.rows.map((entry) => [entry.rsid, entry.gene, entry.allele, entry.genotype]),
    ).toEqual([
      ["rs4244285", "CYP2C19", "*2", "A/G"],
      ["rs4986893", "CYP2C19", "*3", "no call"],
    ]);
    expect(
      audits.map((entry) => [entry.tool, entry.args, entry.result, entry.rowCount]),
    ).toEqual([["genome.report", {}, { report_id: "report-1", rows: 2 }, 2]]);
  });
});

describe("createChatTools and the genome tools", () => {
  const ports: QueryToolPorts = {
    findSubject: async () => null,
    findObservations: async () => [],
    appendAudit: async () => undefined,
  };

  test("a personal turn with genome deps gets genome_report and dna_ask", () => {
    const { deps } = depsWith(null);
    const names = Object.keys(createChatTools(PERSONAL, { query: ports, genome: deps }));
    expect(names.filter((name) => ["genome_report", "dna_ask"].includes(name))).toEqual([
      "genome_report",
      "dna_ask",
    ]);
  });

  test("genome_variants comes only with the genome deps' variant ports (#307)", () => {
    const variants = {
      scope: PERSONAL,
      permit: () => ({ ok: true }) as const,
      ports: {
        listDatasets: async () => [],
        findVariants: async () => [],
        appendAudit: async () => undefined,
      },
    };
    const { deps } = depsWith(null, { variants });
    const synthetic = { ...PERSONAL, mode: "synthetic" } as const;
    const has = (scope: typeof PERSONAL | typeof synthetic, genome?: GenomeToolDeps) =>
      Object.keys(createChatTools(scope, { query: ports, genome })).includes(
        "genome_variants",
      );
    expect(has(PERSONAL, deps)).toBe(true);
    expect(has(PERSONAL, depsWith(null).deps)).toBe(false);
    expect(has(synthetic, deps)).toBe(false);
    expect(has(PERSONAL)).toBe(false);
  });

  test("a synthetic scope never gets them, even if deps are passed", () => {
    const { deps } = depsWith(null);
    const synthetic = { ...PERSONAL, mode: "synthetic" } as const;
    const names = Object.keys(createChatTools(synthetic, { query: ports, genome: deps }));
    expect(names.some((name) => name === "dna_ask" || name === "genome_report")).toBe(
      false,
    );
  });

  test("without deps (eval, training, smoke) they are never there", () => {
    const names = Object.keys(createChatTools(PERSONAL, { query: ports }));
    expect(names.some((name) => name === "dna_ask" || name === "genome_report")).toBe(
      false,
    );
  });
});
