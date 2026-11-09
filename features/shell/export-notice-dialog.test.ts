import { describe, expect, test } from "bun:test";

import {
  checkExport,
  EXPORT_CHECK_FAILED,
  EXPORT_CHECKING,
  noticeText,
} from "./export-notice-dialog";

const answering = (asked: string[], response: () => Response): typeof fetch =>
  (async (input: unknown) => {
    asked.push(String(input));
    return response();
  }) as unknown as typeof fetch;

describe("the export notice (#531)", () => {
  test("Download asks only for the check, and reads its line", async () => {
    const asked: string[] = [];
    const state = await checkExport(
      "t1",
      "markdown",
      answering(asked, () =>
        Response.json({
          status: "ready",
          line: "This export contains: 2 lab values. Download anyway?",
        }),
      ),
    );
    expect(asked).toEqual(["/api/threads/t1/export?check=1"]);
    expect(state).toEqual({
      pick: "markdown",
      phase: "ready",
      line: "This export contains: 2 lab values. Download anyway?",
    });
  });

  test("PDF asks for the print check", async () => {
    const asked: string[] = [];
    await checkExport(
      "t1",
      "print",
      answering(asked, () => Response.json({ status: "ready", line: "x" })),
    );
    expect(asked).toEqual(["/api/threads/t1/export?format=print&check=1"]);
  });

  test("a refusal keeps its sentence; a failure or an odd answer offers no Download", async () => {
    expect(
      await checkExport(
        "t1",
        "markdown",
        answering([], () => Response.json({ status: "refused", line: "No file." })),
      ),
    ).toEqual({ pick: "markdown", phase: "refused", line: "No file." });
    expect(
      await checkExport(
        "t1",
        "markdown",
        answering([], () => new Response("down", { status: 500 })),
      ),
    ).toEqual({ pick: "markdown", phase: "failed" });
    expect(
      await checkExport(
        "t1",
        "markdown",
        answering([], () => Response.json({ status: "ok" })),
      ),
    ).toEqual({ pick: "markdown", phase: "failed" });
  });

  test("each state reads one plain line", () => {
    expect(noticeText({ pick: "markdown", phase: "checking" })).toBe(EXPORT_CHECKING);
    expect(noticeText({ pick: "markdown", phase: "failed" })).toBe(EXPORT_CHECK_FAILED);
    expect(noticeText({ pick: "print", phase: "ready", line: "A line." })).toBe(
      "A line.",
    );
  });
});
