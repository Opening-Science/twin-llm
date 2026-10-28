import { describe, expect, test } from "bun:test";

import { createThreadExportHandler } from "./thread-export-handler";

const THREAD = { title: "What was their latest HbA1c?", turns: [] };

describe("createThreadExportHandler", () => {
  test("the owner gets a Markdown attachment named after the thread", async () => {
    const response = await createThreadExportHandler({
      loadOwnedThread: async () => THREAD,
      today: () => "2026-10-28",
    })("t1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="what-was-their-latest-hba1c.md"',
    );
    expect(await response.text()).toContain("Exported from TwinLLM on 28 Oct 2026.");
  });

  test("anyone else, or no such thread, gets a plain 404", async () => {
    const response = await createThreadExportHandler({
      loadOwnedThread: async () => null,
      today: () => "2026-10-28",
    })("t1");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
