import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("getLatestVitronicSummary", () => {
  test("chat keys come only from the isSelf subject's newest snapshot", () => {
    const source = readFileSync(join(import.meta.dir, "connection.ts"), "utf8");
    expect(source).toContain("where: { userId, subject: { isSelf: true } }");
    expect(source).toContain('orderBy: { syncedAt: "desc" }');
    expect(source).toContain("toChatVitronicSummary");
    const chatFn = source.slice(source.indexOf("export const getLatestVitronicSummary"));
    expect(chatFn).toContain("select: { id: true, summary: true, subjectId: true }");
    expect(chatFn).not.toContain("markers");
    expect(chatFn).not.toContain("measures");
  });
});
