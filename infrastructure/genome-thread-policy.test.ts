import { describe, expect, test } from "bun:test";

import { sha256Hex } from "@/packages/audit/hash";

import { genomeThreadRefusedEvent } from "./genome-thread-audit";
import {
  assertHistoryMayLeave,
  historyShowsGenome,
  isGenomeAuditTool,
  isLocalChatModel,
  LOCAL_ONLY_AUDIT_TOOLS,
  permitGenomeThreadExport,
  permitGenomeThreadTurn,
  requestsGenomeTools,
  toolPartsUseGenome,
} from "./genome-thread-policy";

const REFUSED = {
  ok: false,
  code: "GENOME_THREAD_LOCAL_ONLY",
  error:
    "This thread used your genome report or imported data, so it only runs on local models.",
};

const part = (tool: string) => ({
  seq: 1,
  tool,
  input: { rsid: "rs0000001" },
  output: { genotype: "synthetic" },
  argsSha256: "a".repeat(64),
  resultSha256: "b".repeat(64),
  rowCount: null,
  at: "2026-10-27T00:00:00.000Z",
});

describe("toolPartsUseGenome", () => {
  test("a stored genome_report or dna_ask part marks the thread", () => {
    expect(toolPartsUseGenome([part("coverage"), part("genome_report")])).toBe(true);
    expect(toolPartsUseGenome([part("dna_ask")])).toBe(true);
  });

  test("other tools, null and non-arrays do not", () => {
    expect(toolPartsUseGenome([part("coverage"), part("show_view")])).toBe(false);
    expect(toolPartsUseGenome(null)).toBe(false);
    expect(toolPartsUseGenome({ tool: "dna_ask" })).toBe(false);
  });

  test("a malformed part that names a genome tool still counts", () => {
    expect(toolPartsUseGenome([{ tool: "dna_ask" }])).toBe(true);
  });
});

describe("genome markers", () => {
  test("audit tools of the genome chat tools", () => {
    expect(isGenomeAuditTool("genome.report")).toBe(true);
    expect(isGenomeAuditTool("genome.dna_ask")).toBe(true);
    expect(isGenomeAuditTool("genome.report.store")).toBe(false);
    expect(isGenomeAuditTool("provider.personal_data_sent")).toBe(false);
  });

  test("a tool list with a genome tool requests one", () => {
    expect(requestsGenomeTools(["genome_report", "dna_ask"])).toBe(true);
    expect(requestsGenomeTools(["coverage", "baseline_deviation"])).toBe(false);
  });

  test("history with a /genome prompt or a Carbon-X label shows genome use", () => {
    expect(historyShowsGenome([{ role: "user", content: "/genome" }])).toBe(true);
    expect(historyShowsGenome([{ role: "user", content: " /genome CYP2C19" }])).toBe(
      true,
    );
    expect(
      historyShowsGenome([
        { role: "assistant", content: "Carbon-X (research model): synthetic." },
      ]),
    ).toBe(true);
    expect(historyShowsGenome([{ role: "user", content: "/genomes are fun" }])).toBe(
      false,
    );
    expect(historyShowsGenome([{ role: "assistant", content: "/genome" }])).toBe(false);
    expect(historyShowsGenome([{ role: "user", content: "How did I sleep?" }])).toBe(
      false,
    );
  });

  test("local means Ollama on loopback", () => {
    expect(isLocalChatModel("ollama", true)).toBe(true);
    expect(isLocalChatModel("ollama", false)).toBe(false);
    expect(isLocalChatModel("exoscale", true)).toBe(false);
  });
});

describe("permitGenomeThreadTurn", () => {
  test("a genome thread is refused for a model that is not local", () => {
    expect(permitGenomeThreadTurn({ genomeThread: true, chatIsLocal: false })).toEqual(
      REFUSED,
    );
  });

  test("a genome thread runs on a local model; any other thread anywhere", () => {
    expect(permitGenomeThreadTurn({ genomeThread: true, chatIsLocal: true })).toEqual({
      ok: true,
    });
    expect(permitGenomeThreadTurn({ genomeThread: false, chatIsLocal: false })).toEqual({
      ok: true,
    });
  });
});

describe("permitGenomeThreadExport (for /report, #44)", () => {
  test("a genome thread is exported only to a local recipient", () => {
    expect(
      permitGenomeThreadExport({ genomeThread: true, recipientIsLocal: false }),
    ).toEqual(REFUSED);
    expect(
      permitGenomeThreadExport({ genomeThread: true, recipientIsLocal: true }),
    ).toEqual({ ok: true });
    expect(
      permitGenomeThreadExport({ genomeThread: false, recipientIsLocal: false }),
    ).toEqual({ ok: true });
  });
});

describe("assertHistoryMayLeave", () => {
  const plain = [{ role: "user" as const, content: "How did I sleep?" }];

  test("a genome thread's history never goes to a model that is not local", () => {
    expect(() =>
      assertHistoryMayLeave({ chatIsLocal: false, genomeThread: true, messages: plain }),
    ).toThrow("GENOME_THREAD_LOCAL_ONLY: genome history held back");
  });

  test("genome markers in the history fail closed even when the thread says no", () => {
    expect(() =>
      assertHistoryMayLeave({
        chatIsLocal: false,
        genomeThread: false,
        messages: [
          ...plain,
          { role: "assistant", content: "Carbon-X (research model): synthetic." },
        ],
      }),
    ).toThrow("GENOME_THREAD_LOCAL_ONLY: genome history held back");
  });

  test("a local model gets it; a plain history goes anywhere", () => {
    expect(
      assertHistoryMayLeave({ chatIsLocal: true, genomeThread: true, messages: plain }),
    ).toBeUndefined();
    expect(
      assertHistoryMayLeave({ chatIsLocal: false, genomeThread: false, messages: plain }),
    ).toBeUndefined();
  });
});

describe("genomeThreadRefusedEvent", () => {
  test("provider and a hash of the thread id, nothing else", () => {
    expect(
      genomeThreadRefusedEvent({
        actor: "user_synthetic_1",
        sessionId: "turn-synthetic-1",
        threadId: "thread-synthetic-1",
        provider: "exoscale",
      }),
    ).toEqual({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      subjectRef: null,
      tool: "genome.thread.refused",
      args: { provider: "exoscale", threadSha256: sha256Hex("thread-synthetic-1") },
      result: { refused: true },
      rowCount: 0,
    });
  });

  test("an export refusal names its own tool", () => {
    expect(
      genomeThreadRefusedEvent({
        actor: "user_synthetic_1",
        sessionId: "export-synthetic-1",
        threadId: "thread-synthetic-1",
        provider: "hosted",
        tool: "genome.thread.export_refused",
      }).tool,
    ).toBe("genome.thread.export_refused");
  });
});

describe("imported-data tools make a thread local-only too", () => {
  test("a stored imported-data tool part, audit row or skill tool counts", () => {
    expect(toolPartsUseGenome([{ tool: "imported_latest" }])).toBe(true);
    expect(toolPartsUseGenome([{ tool: "imported_trend" }, { tool: "coverage" }])).toBe(
      true,
    );
    expect(isGenomeAuditTool("imported_datasets")).toBe(true);
    expect(isGenomeAuditTool("personal-data.list")).toBe(false);
    expect(requestsGenomeTools(["imported_trend"])).toBe(true);
    expect(LOCAL_ONLY_AUDIT_TOOLS).toEqual([
      "genome.report",
      "genome.dna_ask",
      "imported_datasets",
      "imported_latest",
      "imported_trend",
      "imported_table",
      "imported_conditions",
    ]);
    expect(requestsGenomeTools(["imported_table"])).toBe(true);
    expect(requestsGenomeTools(["imported_conditions"])).toBe(true);
  });
});
