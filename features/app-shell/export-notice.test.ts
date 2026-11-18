import { describe, expect, test } from "bun:test";

import { checkExport, confirmExport, EXPORT_COPY } from "./export-notice";

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

describe("the export notice's download (#853)", () => {
  const made = () =>
    new Response(new Uint8Array([37, 80, 68, 70]), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="sleep-week.pdf"',
      },
    });

  test("asks for the confirmed file and keeps the server's file name", async () => {
    const asked: string[] = [];
    const answer = await confirmExport("t1", "pdf", answering(asked, made));
    expect(asked).toEqual(["/api/threads/t1/export?format=pdf&confirm=1"]);
    expect(answer.status).toBe("made");
    if (answer.status !== "made") return;
    expect(answer.name).toBe("sleep-week.pdf");
    expect([...new Uint8Array(await answer.file.arrayBuffer())]).toEqual([
      37, 80, 68, 70,
    ]);
  });

  test("a refusal or a failure shows the server's sentence, never a file", async () => {
    const sentence = "The file could not be made, so nothing was recorded. Try again.";
    const plain = (status: number) => () =>
      new Response(sentence, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    for (const status of [403, 500]) {
      expect(await confirmExport("t1", "markdown", answering([], plain(status)))).toEqual(
        {
          status: "failed",
          line: sentence,
        },
      );
    }
    const locked = () =>
      Response.json(
        {
          code: "PERSONAL_DATA_LOCKED",
          message: "Your data is locked. Unlock it to continue.",
        },
        { status: 423 },
      );
    expect(await confirmExport("t1", "pdf", answering([], locked))).toEqual({
      status: "failed",
      line: "Your data is locked. Unlock it to continue.",
    });
  });

  test("an error page or an empty answer gets the plain failure line", async () => {
    const failed = { status: "failed" as const, line: EXPORT_COPY.notMade };
    const html = () =>
      new Response("<!DOCTYPE html><html>Internal error</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      });
    const empty = () => new Response(null, { status: 502 });
    for (const answer of [html, empty]) {
      expect(await confirmExport("t1", "pdf", answering([], answer))).toEqual(failed);
    }
  });

  test("a lost connection gets the plain failure line", async () => {
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await confirmExport("t1", "pdf", offline)).toEqual({
      status: "failed",
      line: EXPORT_COPY.notMade,
    });
  });
});
