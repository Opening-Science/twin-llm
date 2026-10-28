import { describe, expect, test } from "bun:test";

import { type LiteratureRecord, toLiteratureRecord } from "./article";
import { readLiteratureCorpus } from "./corpus";
import { fixture } from "./fixture";
import { parsePmcMetadata } from "./pmc";
import type { SpecialtyId } from "./specialties";

const record = (specialty: SpecialtyId): LiteratureRecord =>
  toLiteratureRecord(parsePmcMetadata(fixture("metadata.json")), {
    specialty,
    licence: "cc-by",
    query: "q",
    fetchedAt: "2026-10-28T00:00:00.000Z",
  });

const portsFor = (files: Record<string, Record<string, string>>) => ({
  listFiles: async (specialty: SpecialtyId) => Object.keys(files[specialty] ?? {}),
  readFile: async (specialty: SpecialtyId, file: string) => {
    const body = files[specialty]?.[file];
    if (body === undefined) throw new Error(`missing ${file}`);
    return body;
  },
});

describe("readLiteratureCorpus", () => {
  test("reads records and their text, ignoring other files", async () => {
    const articles = await readLiteratureCorpus(
      portsFor({
        diet: {
          "PMC1000001.2.json": JSON.stringify(record("diet")),
          "PMC1000001.2.txt": "body",
          "PMC1000001.2.json.partial": "{",
          "notes.md": "x",
        },
      }),
      ["diet", "sleep"],
    );
    expect(articles).toEqual([{ record: record("diet"), text: "body" }]);
  });

  test("refuses a record filed under another specialty", async () => {
    await expect(
      readLiteratureCorpus(
        portsFor({ sleep: { "PMC1000001.2.json": JSON.stringify(record("diet")) } }),
        ["sleep"],
      ),
    ).rejects.toThrow("LITERATURE_RECORD_MISFILED: sleep/PMC1000001.2.json");
  });
});
