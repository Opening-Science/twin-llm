import { describe, expect, test } from "bun:test";

import type { ReferenceRow } from "../../features/vitronic/reference-list";

import {
  REFERENCE_FILE,
  runReferenceList,
  type ReferenceListDeps,
} from "./reference-list";

const row = (reference: string, repeat: number, complete: boolean): ReferenceRow => ({
  reference,
  subjectLabel: `label-${reference}`,
  consentRecordedAt: "2026-11-19T09:00:00.000Z",
  consentBy: "operator",
  viatarId: repeat,
  syncedAt: "2026-11-21T10:00:00.000Z",
  preset: "standard",
  repeat,
  glbSha256: "",
  complete,
});

const run = async (argv: readonly string[], user: string | null = "user-1") => {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const asked: string[] = [];
  const deps: ReferenceListDeps = {
    vitronicDir: () => "/data/vitronic",
    localActor: () => "local",
    findAppUserId: async (clerkId) => {
      asked.push(clerkId);
      return user;
    },
    listReferenceScans: async () => [
      row("R01", 1, true),
      row("R02", 2, false),
      row("R03", 1, true),
    ],
    referenceCsv: (rows) => `csv:${rows.length}`,
    writeFile: async (path, text) => {
      written.set(path, text);
    },
  };
  const code = await runReferenceList(
    argv,
    { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } },
    deps,
  );
  return { code, out: out.join(""), err: err.join(""), written, asked };
};

describe("runReferenceList", () => {
  test("writes the list into the vitronic folder and prints counts only", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect([...result.written.entries()]).toEqual([
      [`/data/vitronic/${REFERENCE_FILE}`, "csv:3"],
    ]);
    expect(result.out).toBe(
      `Reference list: 3 scans of 2 subjects, 1 incomplete, written to /data/vitronic/${REFERENCE_FILE}\n`,
    );
    expect(result.out).not.toContain("label-");
    expect(result.asked).toEqual(["local"]);
  });

  test("--user picks another local actor", async () => {
    expect((await run(["--user", "someone"])).asked).toEqual(["someone"]);
  });

  test("an unknown user writes nothing", async () => {
    const result = await run([], null);
    expect(result.code).toBe(1);
    expect(result.written.size).toBe(0);
  });
});
