import { describe, expect, test } from "bun:test";

import { checkExport, EXPORT_COPY } from "./export-notice";

/** A server that answers every request with `answer`, noting what was asked. */
const answering =
  (asked: string[], answer: () => Response) =>
  async (href: string): Promise<Response> => {
    asked.push(href);
    return answer();
  };

const ready = () =>
  Response.json({ status: "ready", line: "No stored values were found." });

describe("the export notice's check (#531)", () => {
  test("Markdown asks for the plain check, PDF for the PDF one", async () => {
    const asked: string[] = [];
    await checkExport("t1", "markdown", answering(asked, ready));
    await checkExport("t1", "pdf", answering(asked, ready));
    expect(asked).toEqual([
      "/api/threads/t1/export?check=1",
      "/api/threads/t1/export?format=pdf&check=1",
    ]);
  });

  test("a ready or refused notice keeps its own sentence", async () => {
    expect(await checkExport("t1", "pdf", answering([], ready))).toEqual({
      status: "ready",
      line: "No stored values were found.",
    });
    const refused = () => Response.json({ status: "refused", line: "No file was made." });
    expect(await checkExport("t1", "pdf", answering([], refused))).toEqual({
      status: "refused",
      line: "No file was made.",
    });
  });

  test("an error status or an odd answer is a failure, never ready", async () => {
    const failed = { status: "failed" as const, line: EXPORT_COPY.failed };
    const error = () => Response.json({ status: "ready", line: "x" }, { status: 500 });
    const odd = () => Response.json({ status: "ok" });
    const text = () => new Response("not json");
    for (const answer of [error, odd, text]) {
      expect(await checkExport("t1", "markdown", answering([], answer))).toEqual(failed);
    }
  });
});
