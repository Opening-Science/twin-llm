import { describe, expect, test } from "bun:test";

import type { Disclosure } from "@/infrastructure/disclosure-ledger";
import type { FreeTextCheck } from "@/infrastructure/free-text-check";
import type { AppendInput } from "@/packages/audit/append";

import {
  createThreadExportHandler,
  EXPORT_GENOME_IDS_BLOCKED,
  EXPORT_NOT_RECORDED,
  exportFormat,
  type ExportFormat,
} from "./thread-export-handler";
import { EXPORT_UNCONFIRMED, type ExportStep, parseExportNotice } from "./export-notice";
import type { ExportableThread } from "./thread-markdown";

const THREAD: ExportableThread = { title: "What was their latest HbA1c?", turns: [] };

const GENOME_THREAD: ExportableThread = {
  title: "/genome what does my report say",
  turns: [{ id: "t1", prompt: "/genome what does my report say", answers: [] }],
};

const handler = (
  thread: ExportableThread | null,
  options: Readonly<{
    local?: boolean;
    ledgerFails?: boolean;
    check?: (text: string) => Promise<FreeTextCheck>;
  }> = {},
) => {
  const audits: AppendInput[] = [];
  const disclosures: Disclosure[] = [];
  const checked: { actor: string; typed: readonly string[]; text: string }[] = [];
  const exportThread = createThreadExportHandler({
    freeTextChecker: (actor, typed) => async (text) => {
      checked.push({ actor, typed, text });
      return options.check === undefined ? NOTHING_FOUND : options.check(text);
    },
    loadOwnedThread: async () => thread,
    actorId: async () => "local",
    recipientIsLocal: () => options.local ?? true,
    appendAudit: async (input) => {
      audits.push(input);
    },
    // The ledger row and its paired audit row are written together, or neither.
    recordDisclosure: async (disclosure, paired) => {
      if (options.ledgerFails === true) throw new Error("ledger down");
      disclosures.push(disclosure);
      if (paired !== undefined) audits.push(paired);
      return { seq: 1n, auditSeq: 1n };
    },
    dataMode: () => "personal",
    today: () => "2026-10-28",
  });
  /** The confirmed request unless a test asks for another step. */
  const run = (
    threadId: string,
    format: ExportFormat = "markdown",
    step: ExportStep = "confirmed",
  ) => exportThread(threadId, format, step);
  return { run, audits, disclosures, checked };
};

const NOTHING_FOUND: FreeTextCheck = { matches: [] };

/** A synthetic thread whose answer repeats a stored lab value and an rsID. */
const LAB_THREAD: ExportableThread = {
  title: "Synthetic cholesterol question",
  turns: [
    {
      id: "t1",
      prompt: "What does a synthetic total cholesterol mean?",
      answers: [
        {
          id: "r",
          modelId: "m",
          modelName: "qwen3:4b",
          status: "COMPLETE",
          text: "Your stored 195 mg/dL is above 190 mg/dL. rs0000001 is synthetic.",
          tools: [],
          metrics: null,
        },
      ],
    },
  ],
};

const found =
  (...matches: FreeTextCheck["matches"]) =>
  async (): Promise<FreeTextCheck> => ({
    matches,
  });

describe("createThreadExportHandler", () => {
  test("an export is in the disclosure ledger before the file is returned (#140)", async () => {
    const { run, disclosures } = handler(THREAD);
    const response = await run("t1", "fhir");
    const body = await response.text();
    expect(disclosures).toEqual([
      {
        actor: "local",
        sessionId: "t1",
        kind: "export-file",
        recipient: "export file",
        target: "fhir",
        purpose: "thread export",
        categories: ["question text", "answers"],
        refs: [],
        payloadBytes: Buffer.byteLength(body, "utf8"),
        threadId: "t1",
        synthetic: false,
        freeText: { matches: [] },
      },
    ]);
  });

  test("when the ledger cannot be written there is no file and no audit row", async () => {
    const { run, audits } = handler(THREAD, { ledgerFails: true });
    const response = await run("t1");
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Disposition")).toBe(null);
    expect(await response.text()).toBe(EXPORT_NOT_RECORDED);
    expect(audits).toEqual([]);
  });

  test("the owner gets a Markdown attachment named after the thread, audited", async () => {
    const { run, audits } = handler(THREAD);
    const response = await run("t1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="what-was-their-latest-hba1c.md"',
    );
    expect(await response.text()).toContain("Exported from TwinLLM on 28 Oct 2026.");
    expect(audits.map((audit) => [audit.tool, audit.args])).toEqual([
      ["thread.export", { format: "markdown" }],
    ]);
  });

  test("?format=fhir is a DocumentReference whose attachment is the same Markdown", async () => {
    const { run } = handler(THREAD);
    const markdown = await (await run("t1", "markdown")).text();
    const response = await run("t1", exportFormat("fhir"));
    expect(response.headers.get("Content-Type")).toBe(
      "application/fhir+json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="what-was-their-latest-hba1c.fhir.json"',
    );
    const document = (await response.json()) as {
      resourceType: string;
      date: string;
      content: { attachment: { contentType: string; data: string } }[];
    };
    expect(document.resourceType).toBe("DocumentReference");
    expect(document.date).toBe("2026-10-28T00:00:00Z");
    const attachment = document.content[0]?.attachment;
    expect(attachment?.contentType).toBe("text/markdown; charset=utf-8");
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(attachment?.data ?? ""), (c) => c.charCodeAt(0)),
      ),
    ).toBe(markdown);
  });

  test("a genome thread exports on a local-only app and is refused otherwise", async () => {
    expect((await handler(GENOME_THREAD, { local: true }).run("t1")).status).toBe(200);
    const refused = handler(GENOME_THREAD, { local: false });
    const response = await refused.run("t1");
    expect(response.status).toBe(403);
    expect(refused.audits.map((audit) => audit.tool)).toEqual([
      "genome.thread.export_refused",
    ]);
  });

  test("an answer that called a genome tool makes it a genome thread", async () => {
    const thread: ExportableThread = {
      title: "What does the report say?",
      turns: [
        {
          id: "t1",
          prompt: "What does the report say?",
          answers: [
            {
              id: "r",
              modelId: "m",
              modelName: "qwen3:4b",
              status: "COMPLETE",
              text: "",
              tools: [
                {
                  id: "1",
                  tool: "genome_report",
                  title: "Read the genome report",
                  args: [],
                  state: "done",
                  rowCount: 11,
                  note: null,
                },
              ],
              metrics: null,
            },
          ],
        },
      ],
    };
    expect((await handler(thread, { local: false }).run("t1")).status).toBe(403);
  });

  test("anyone else, or no such thread, gets a plain 404 and no audit row", async () => {
    const { run, audits } = handler(null);
    const response = await run("t1");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(audits).toEqual([]);
  });

  test("?format=print is a page for printing or saving as PDF, audited, same content", async () => {
    const { run, audits } = handler(THREAD);
    const response = await run("t1", exportFormat("print"));
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    const html = await response.text();
    expect(html).toContain("<title>What was their latest HbA1c?</title>");
    expect(html).toContain("<h1>What was their latest HbA1c?</h1>");
    expect(html).toContain("window.print()");
    expect(audits.map((audit) => audit.args)).toEqual([{ format: "print" }]);
  });
});

describe("the free text check of an export (#531)", () => {
  test("every format checks the thread's Markdown, with the person's questions as typed", async () => {
    const markdown = handler(LAB_THREAD);
    const text = await (await markdown.run("t1")).text();
    for (const format of ["markdown", "fhir", "print"] as const) {
      const each = handler(LAB_THREAD);
      await each.run("t1", format);
      expect(each.checked).toEqual([
        {
          actor: "local",
          typed: ["What does a synthetic total cholesterol mean?"],
          text,
        },
      ]);
    }
  });

  test("the row and its audit row record kinds and counts, never the values", async () => {
    const { run, disclosures, audits } = handler(LAB_THREAD, {
      check: found({ kind: "lab value", count: 1 }),
    });
    const response = await run("t1");
    expect(response.status).toBe(200);
    expect(disclosures.map((row) => [row.direction, row.freeText])).toEqual([
      [undefined, { matches: [{ kind: "lab value", count: 1 }] }],
    ]);
    expect(audits.map((audit) => [audit.tool, audit.result])).toEqual([
      [
        "thread.export",
        {
          bytes: expect.any(Number) as number,
          freeText: [{ kind: "lab value", count: 1 }],
        },
      ],
    ]);
    expect(JSON.stringify([disclosures, audits])).not.toContain("195");
  });

  test("the person's own rsIDs withhold a file that could leave this machine", async () => {
    const { run, disclosures, audits } = handler(LAB_THREAD, {
      local: false,
      check: found({ kind: "rsID", count: 1 }, { kind: "lab value", count: 1 }),
    });
    const response = await run("t1");
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Disposition")).toBe(null);
    expect(await response.text()).toBe(EXPORT_GENOME_IDS_BLOCKED);
    expect(disclosures.map((row) => [row.direction, row.freeText])).toEqual([
      [
        "blocked",
        {
          matches: [
            { kind: "rsID", count: 1 },
            { kind: "lab value", count: 1 },
          ],
        },
      ],
    ]);
    // No thread.export row: nothing was exported.
    expect(audits).toEqual([]);
  });

  test("on a local-only app the person's own rsIDs withhold the file too", async () => {
    const { run, disclosures } = handler(LAB_THREAD, {
      local: true,
      check: found({ kind: "rsID", count: 1 }),
    });
    expect((await run("t1")).status).toBe(403);
    expect(disclosures.map((row) => [row.direction, row.freeText])).toEqual([
      ["blocked", { matches: [{ kind: "rsID", count: 1 }] }],
    ]);
  });

  test("a failed check is recorded as not checked; genome-shaped text is withheld", async () => {
    const fails = async (): Promise<FreeTextCheck> => {
      throw new Error("vault locked");
    };
    const plain = handler(THREAD, { local: false, check: fails });
    expect((await plain.run("t1")).status).toBe(200);
    expect(plain.disclosures.map((row) => "freeText" in row)).toEqual([false]);

    const shaped = handler(LAB_THREAD, { local: false, check: fails });
    expect((await shaped.run("t1")).status).toBe(403);
    expect(shaped.disclosures.map((row) => [row.direction, "freeText" in row])).toEqual([
      ["blocked", false],
    ]);
  });

  test("a blocked export whose row cannot be written still makes no file", async () => {
    const { run } = handler(LAB_THREAD, {
      local: false,
      ledgerFails: true,
      check: found({ kind: "genome site", count: 2 }),
    });
    const response = await run("t1");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(EXPORT_GENOME_IDS_BLOCKED);
  });
});

describe("the notice before an export (#531)", () => {
  test("a request that skipped the notice reads nothing and makes nothing", async () => {
    const { run, audits, disclosures, checked } = handler(LAB_THREAD);
    const response = await run("t1", "markdown", "unconfirmed");
    expect(response.status).toBe(428);
    expect(response.headers.get("Content-Disposition")).toBe(null);
    expect(await response.text()).toBe(EXPORT_UNCONFIRMED);
    expect([audits.length, disclosures.length, checked.length]).toEqual([0, 0, 0]);
  });

  test("the check answers one line of kinds and counts; nothing leaves, so no ledger row", async () => {
    const { run, audits, disclosures } = handler(LAB_THREAD, {
      check: found(
        { kind: "lab value", count: 2 },
        { kind: "clinical record", count: 1 },
      ),
    });
    const response = await run("t1", "markdown", "check");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(null);
    expect(parseExportNotice(await response.json())).toEqual({
      status: "ready",
      line: "This export contains: 2 lab values, 1 clinical record. Download anyway?",
    });
    expect(disclosures).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.args, audit.result])).toEqual([
      [
        "thread.export.check",
        { format: "markdown" },
        {
          checked: true,
          freeText: [
            { kind: "lab value", count: 2 },
            { kind: "clinical record", count: 1 },
          ],
        },
      ],
    ]);
    expect(JSON.stringify(audits)).not.toContain("195");
  });

  test("the check of a print export says the same; nothing found says so", async () => {
    const { run } = handler(THREAD);
    expect(parseExportNotice(await (await run("t1", "print", "check")).json())).toEqual({
      status: "ready",
      line: "No stored values were found in this export. Download it?",
    });
  });

  test("a check that finds the person's own rsIDs is refused with the sentence and recorded blocked", async () => {
    const { run, disclosures } = handler(LAB_THREAD, {
      local: true,
      check: found({ kind: "rsID", count: 1 }),
    });
    expect(
      parseExportNotice(await (await run("t1", "markdown", "check")).json()),
    ).toEqual({ status: "refused", line: EXPORT_GENOME_IDS_BLOCKED });
    expect(disclosures.map((row) => row.direction)).toEqual(["blocked"]);
  });

  test("a genome thread off this machine is refused at the check", async () => {
    const { run } = handler(GENOME_THREAD, { local: false });
    const notice = parseExportNotice(await (await run("t1", "markdown", "check")).json());
    expect(notice?.status).toBe("refused");
  });
});
