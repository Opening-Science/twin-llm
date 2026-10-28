import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type { ResponseState } from "./conversation";
import { createThreadExportHandler, exportFormat } from "./thread-export-handler";
import type { ExportableThread } from "./thread-markdown";

const THREAD: ExportableThread = { title: "What was their latest HbA1c?", turns: [] };

const GENOME_THREAD: ExportableThread = {
  title: "/genome what does my report say",
  turns: [{ id: "t1", prompt: "/genome what does my report say", answers: [] }],
};

const handler = (
  thread: ExportableThread | null,
  options: Readonly<{ local?: boolean }> = {},
) => {
  const audits: AppendInput[] = [];
  const run = createThreadExportHandler({
    loadOwnedThread: async () => thread,
    actorId: async () => "local",
    recipientIsLocal: () => options.local ?? true,
    appendAudit: async (input) => {
      audits.push(input);
    },
    today: () => "2026-10-28",
  });
  return { run, audits };
};

describe("createThreadExportHandler", () => {
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
            } as ResponseState,
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
