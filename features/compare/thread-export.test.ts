import { describe, expect, test } from "bun:test";

import type { RecordDisclosure } from "@/infrastructure/disclosure-ledger";
import type { FreeTextCheck } from "@/infrastructure/free-text-check";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import type { AppendInput } from "@/packages/audit/append";

import type { AnswerState, TurnState } from "./conversation";
import {
  exportStep,
  NOT_CHECKED_LINE,
  NOTHING_FOUND_LINE,
  noticeLine,
  parseExportNotice,
} from "./export-notice";
import { fhirDocument } from "./thread-fhir";
import { exportFormat, createThreadExportHandler } from "./thread-export-handler";
import { EXPORT_DISCLAIMER, exportSlug, threadMarkdown } from "./thread-markdown";
import { markdownBodyHtml, printPage } from "./thread-print";

const answer = (over: Partial<AnswerState>): AnswerState => ({
  id: "r1",
  modelId: "qwen3:4b",
  modelName: "Qwen3 4B",
  status: "COMPLETE",
  text: "",
  metrics: null,
  ...over,
});

const REPLY =
  "## Reasoning\nRead rows.\n\n## Evidence Used\n- oura.sleep\n\n## Answer\nHeart rate fell from 78 to 72.5 bpm.\n\n## Uncertainty\nFew readings.";

const TURN: TurnState = {
  id: "turn-1",
  prompt: "How did heart rate\n change for synthetic subject 29bbf012?",
  answers: [
    answer({
      text: REPLY,
      tools: [
        {
          id: "1",
          tool: "trend",
          title: "Fitted a trend",
          args: [{ label: "Measure", value: "8867-4" }],
          state: "done",
          rowCount: 12,
        },
      ],
      attribution: [
        {
          metricKey: "oura.sleep.total_hours",
          label: "Sleep",
          value: 7.1,
          unit: "h",
          source: "oura",
          day: "2026-10-01",
        },
      ],
    }),
    answer({
      id: "r2",
      modelName: "Diet specialist",
      status: "FAILED",
      refusal: "This skill is not offered.",
    }),
    answer({
      id: "r3",
      modelName: "Stopped one",
      status: "FAILED",
      stopped: true,
      text: "## Reasoning\nhidden\n\n## Answer\nPartly written",
    }),
    answer({ id: "r4", modelName: "Still going", status: "STREAMING" }),
  ],
};

describe("the Markdown export (SPEC 9.1, 9.2)", () => {
  const markdown = threadMarkdown({ title: "Heart rate", turns: [TURN] }, "2026-10-28");

  test("header, numbered turn with the prompt on one line, disclaimer kept", () => {
    expect(
      markdown.startsWith("# Heart rate\n\nExported from TwinLLM on 28 Oct 2026."),
    ).toBe(true);
    expect(markdown).toContain(EXPORT_DISCLAIMER);
    expect(EXPORT_DISCLAIMER).toContain("model output, not medical advice");
    expect(markdown).toContain(
      "## 1. How did heart rate change for synthetic subject 29bbf012?",
    );
  });

  test("lookups, the Answer section, uncertainty and evidence with stored keys", () => {
    expect(markdown).toContain(
      "Lookups:\n- Fitted a trend: heart rate (measure 8867-4) · 12 rows",
    );
    expect(markdown).toContain("Heart rate fell from 78 to 72.5 bpm.");
    expect(markdown).not.toContain("Read rows.");
    expect(markdown).toContain("**Uncertainty.** Few readings.");
    expect(markdown).toContain(
      "Evidence:\n- Sleep 7.1 h · From Oura, 1 Oct 2026 (`oura.sleep.total_hours`)",
    );
  });

  test("refused, stopped and streaming answers each get their italic line", () => {
    expect(markdown).toContain("_Refused or failed: This skill is not offered._");
    expect(markdown).toContain("Partly written\n\n_Stopped before it finished._");
    expect(markdown).not.toContain("hidden");
    expect(markdown).toContain("_Still being written when this was exported._");
  });

  test("a withheld answer is never written", () => {
    const withheld = threadMarkdown(
      {
        title: "t",
        turns: [
          {
            ...TURN,
            answers: [
              answer({
                text: REPLY,
                document: { abstained: true } as ResponseDocumentV1,
              }),
            ],
          },
        ],
      },
      "2026-10-28",
    );
    expect(withheld).not.toContain("72.5");
    expect(withheld).toContain("_Withheld: it did not rest on enough data._");
  });

  test("runs of blank lines collapse and the file ends with one newline", () => {
    expect(markdown).not.toMatch(/\n{3,}/);
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });

  test("file names: lower case, dashes, whole words to 60, thread when empty", () => {
    expect(exportSlug("Heart Rate: spring 2026!")).toBe("heart-rate-spring-2026");
    expect(exportSlug("!!!")).toBe("thread");
    const long = exportSlug("word ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("word")).toBe(true);
  });
});

describe("FHIR and print (SPEC 9.3, 9.4)", () => {
  test("a DocumentReference with the Markdown as base64 and no subject", () => {
    const doc = fhirDocument("Heart rate", "# Hi\n", "2026-10-28");
    expect(doc.resourceType).toBe("DocumentReference");
    expect(doc.date).toBe("2026-10-28T00:00:00Z");
    expect("subject" in doc).toBe(false);
    const content = doc.content as { attachment: { data: string; title: string } }[];
    expect(
      Buffer.from(content[0]?.attachment.data ?? "", "base64").toString("utf8"),
    ).toBe("# Hi\n");
    expect(content[0]?.attachment.title).toBe("heart-rate.md");
  });

  test("model text never becomes markup", () => {
    const html = markdownBodyHtml("## <script>alert(1)</script>\n\n**bold** and `code`");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(printPage("<b>t</b>", "x")).toContain("<title>&lt;b&gt;t&lt;/b&gt;</title>");
  });
});

describe("the notice helpers (SERVER-SPEC 3.7)", () => {
  test("the step, the format and the line", () => {
    expect(exportStep(new URLSearchParams("check=1"))).toBe("check");
    expect(exportStep(new URLSearchParams("confirm=1"))).toBe("confirmed");
    expect(exportStep(new URLSearchParams(""))).toBe("unconfirmed");
    expect(exportFormat("fhir")).toBe("fhir");
    expect(exportFormat("pdf")).toBe("markdown");
    expect(noticeLine(null)).toBe(NOT_CHECKED_LINE);
    expect(noticeLine({ matches: [] })).toBe(NOTHING_FOUND_LINE);
    expect(noticeLine({ matches: [{ kind: "lab value", count: 2 }] })).toBe(
      "This export contains: 2 lab values. Download anyway?",
    );
  });

  test("the client reads only ready or refused with a line", () => {
    expect(parseExportNotice({ status: "ready", line: "x" })).toEqual({
      status: "ready",
      line: "x",
    });
    expect(parseExportNotice({ status: "maybe", line: "x" })).toBeNull();
    expect(parseExportNotice({ status: "ready" })).toBeNull();
    expect(parseExportNotice(null)).toBeNull();
  });
});

type Run = { audit: AppendInput[]; ledger: string[] };

const handler = (
  over: Partial<{
    thread: { title: string; turns: TurnState[] } | null;
    check: () => Promise<FreeTextCheck>;
    local: boolean;
    record: RecordDisclosure;
  }> = {},
) => {
  const run: Run = { audit: [], ledger: [] };
  const record: RecordDisclosure =
    over.record ??
    (async (disclosure, paired) => {
      run.ledger.push(disclosure.direction ?? "sent");
      if (paired !== undefined) run.audit.push(paired);
      return { seq: 1n, auditSeq: 1n };
    });
  const exportThread = createThreadExportHandler({
    loadOwnedThread: async () =>
      over.thread === undefined
        ? { title: "Synthetic thread", turns: [TURN] }
        : over.thread,
    actorId: async () => "actor-1",
    recipientIsLocal: () => over.local ?? true,
    appendAudit: async (input) => {
      run.audit.push(input);
    },
    recordDisclosure: record,
    freeTextChecker: () => over.check ?? (async () => ({ matches: [] })),
    dataMode: () => "synthetic",
    today: () => "2026-10-28",
  });
  return { run, exportThread };
};

describe("the export route (SERVER-SPEC 3.7)", () => {
  test("unconfirmed is 428 before anything is read; unknown is 404", async () => {
    const { run, exportThread } = handler();
    expect((await exportThread("t", "markdown", "unconfirmed")).status).toBe(428);
    expect(run.audit).toEqual([]);
    const missing = handler({ thread: null });
    expect((await missing.exportThread("t", "markdown", "check")).status).toBe(404);
  });

  test("the check writes thread.export.check and answers one line; no ledger row", async () => {
    const { run, exportThread } = handler();
    const response = await exportThread("t", "markdown", "check");
    expect(await response.json()).toEqual({ status: "ready", line: NOTHING_FOUND_LINE });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(run.audit.map((row) => row.tool)).toEqual(["thread.export.check"]);
    expect(run.ledger).toEqual([]);
  });

  test("confirmed: the ledger row and its thread.export row come before the file", async () => {
    const { run, exportThread } = handler();
    const response = await exportThread("t", "markdown", "confirmed");
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("synthetic-thread.md");
    expect(run.ledger).toEqual(["sent"]);
    expect(run.audit.map((row) => row.tool)).toEqual(["thread.export"]);
    expect(run.audit[0]?.rowCount).toBe(4);
  });

  test("a failed ledger write makes no file", async () => {
    const { exportThread } = handler({
      record: async () => {
        throw new Error("down");
      },
    });
    expect((await exportThread("t", "fhir", "confirmed")).status).toBe(500);
  });

  test("the person's genome identifiers: blocked, no file, refused notice", async () => {
    const { run, exportThread } = handler({
      check: async () => ({ matches: [{ kind: "rsID", count: 1 }] }),
    });
    expect(await (await exportThread("t", "markdown", "check")).json()).toEqual({
      status: "refused",
      line: "This thread holds identifiers from your genome, so no file was made.",
    });
    expect((await exportThread("t", "markdown", "confirmed")).status).toBe(403);
    expect(run.ledger).toEqual(["blocked", "blocked"]);
  });

  test("a genome thread leaves only to this machine", async () => {
    const genome: TurnState = {
      ...TURN,
      answers: [
        answer({
          tools: [
            {
              id: "1",
              tool: "genome_report",
              title: "Read the released genome report",
              args: [],
              state: "done",
              rowCount: 1,
            },
          ],
        }),
      ],
    };
    const { run, exportThread } = handler({
      thread: { title: "g", turns: [genome] },
      local: false,
    });
    expect((await exportThread("t", "print", "confirmed")).status).toBe(403);
    expect(run.audit.map((row) => row.tool)).toEqual(["genome.thread.export_refused"]);
  });
});
