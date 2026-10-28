import { describe, expect, test } from "bun:test";

import type { LiteratureRecord } from "./article";
import { fetchLiterature, type LiteratureFetchPorts } from "./fetch";
import { fixture } from "./fixture";
import { LITERATURE_LICENCES } from "./licence";

const META = JSON.parse(fixture("metadata.json")) as Record<string, unknown>;

const listing = (pmcid: string, version: number): string =>
  `<ListBucketResult><Contents><Key>metadata/${pmcid}.${version}.json</Key></Contents></ListBucketResult>`;

/** Three hits: CC BY, an author manuscript (TDM), and CC BY-NC. */
const RESPONSES: Record<string, string> = {
  "metadata%2FPMC1000001.": listing("PMC1000001", 2),
  "metadata/PMC1000001.2.json": fixture("metadata.json"),
  "metadata%2FPMC1000002.": listing("PMC1000002", 1),
  "metadata/PMC1000002.1.json": JSON.stringify({
    ...META,
    pmcid: "PMC1000002",
    version: 1,
    license_code: "TDM",
  }),
  "metadata%2FPMC1000003.": listing("PMC1000003", 1),
  "metadata/PMC1000003.1.json": JSON.stringify({
    ...META,
    pmcid: "PMC1000003",
    version: 1,
    license_code: "CC BY-NC",
    text_url: "s3://pmc-oa-opendata/PMC1000003.1/PMC1000003.1.txt",
  }),
};

const fakePorts = (
  overrides: Partial<LiteratureFetchPorts> = {},
): {
  ports: LiteratureFetchPorts;
  urls: string[];
  written: LiteratureRecord[];
  lines: string[];
} => {
  const urls: string[] = [];
  const written: LiteratureRecord[] = [];
  const lines: string[] = [];
  const ports: LiteratureFetchPorts = {
    getText: async (url) => {
      urls.push(url);
      if (url.includes("esearch.fcgi")) return fixture("esearch.json");
      const hit = Object.entries(RESPONSES).find(([key]) => url.endsWith(key));
      if (!hit) throw new Error(`HTTP 404`);
      return hit[1];
    },
    getArticle: async (url) => {
      urls.push(url);
      return fixture("article.txt");
    },
    hasRecord: async () => false,
    writeArticle: async (record) => {
      written.push(record);
    },
    now: () => new Date("2026-10-28T12:00:00.000Z"),
    log: (line) => {
      lines.push(line);
    },
    ...overrides,
  };
  return { ports, urls, written, lines };
};

const OPTIONS = {
  specialty: "diet",
  limit: 5,
  allow: LITERATURE_LICENCES,
  dryRun: false,
} as const;

describe("fetchLiterature", () => {
  test("stores CC articles with their licence and skips author manuscripts", async () => {
    const { ports, written, lines } = fakePorts();
    const result = await fetchLiterature(OPTIONS, ports);
    expect(result).toEqual({
      searched: 3,
      stored: [
        { pmcid: "PMC1000001", licence: "cc-by" },
        { pmcid: "PMC1000003", licence: "cc-by-nc" },
      ],
      skipped: [{ pmcid: "PMC1000002", reason: "unknown-licence", detail: "TDM" }],
    });
    expect(
      written.map((record) => [record.pmcid, record.version, record.licence]),
    ).toEqual([
      ["PMC1000001", 2, "cc-by"],
      ["PMC1000003", 1, "cc-by-nc"],
    ]);
    expect(written[0]?.fetchedAt).toBe("2026-10-28T12:00:00.000Z");
    expect(lines).toEqual([
      "stored PMC1000001 cc-by",
      "skipped PMC1000002 unknown-licence (TDM)",
      "stored PMC1000003 cc-by-nc",
    ]);
  });

  test("an allow list narrows what is stored", async () => {
    const { ports, written } = fakePorts();
    const result = await fetchLiterature({ ...OPTIONS, allow: ["cc0", "cc-by"] }, ports);
    expect(written.map((record) => record.pmcid)).toEqual(["PMC1000001"]);
    expect(result.skipped).toEqual([
      { pmcid: "PMC1000002", reason: "unknown-licence", detail: "TDM" },
      { pmcid: "PMC1000003", reason: "not-allowed", detail: "CC BY-NC" },
    ]);
  });

  test("stops at the limit and searches for three times as many", async () => {
    const { ports, urls } = fakePorts();
    const result = await fetchLiterature({ ...OPTIONS, limit: 1 }, ports);
    expect(result.stored).toEqual([{ pmcid: "PMC1000001", licence: "cc-by" }]);
    expect(urls[0]).toContain("retmax=3&");
    expect(urls[0]).toContain("tool=twinllm");
  });

  test("a dry run reads metadata but no text and writes nothing", async () => {
    const { ports, urls, written, lines } = fakePorts();
    await fetchLiterature({ ...OPTIONS, dryRun: true }, ports);
    expect(written).toEqual([]);
    expect(urls.some((url) => url.endsWith(".txt?md5=11"))).toBe(false);
    expect(lines[0]).toBe("would store PMC1000001 cc-by");
  });

  test("skips articles already stored and records a failed one", async () => {
    const { ports } = fakePorts({
      hasRecord: async (_specialty, pmcid) => pmcid === "PMC1000001",
      getArticle: async () => {
        throw new Error("HTTP 503");
      },
    });
    const result = await fetchLiterature(OPTIONS, ports);
    expect(result.stored).toEqual([]);
    expect(result.skipped).toEqual([
      { pmcid: "PMC1000001", reason: "already-stored" },
      { pmcid: "PMC1000002", reason: "unknown-licence", detail: "TDM" },
      { pmcid: "PMC1000003", reason: "failed", detail: "HTTP 503" },
    ]);
  });

  test("skips retracted, non-open-access and missing articles", async () => {
    const { ports } = fakePorts({
      getText: async (url) => {
        if (url.includes("esearch.fcgi")) return fixture("esearch.json");
        if (url.endsWith("metadata%2FPMC1000001.")) return listing("PMC1000001", 1);
        if (url.endsWith("metadata%2FPMC1000002.")) return listing("PMC1000002", 1);
        if (url.endsWith("metadata%2FPMC1000003.")) return "<ListBucketResult/>";
        if (url.endsWith("PMC1000001.1.json")) {
          return JSON.stringify({ ...META, is_retracted: true });
        }
        return JSON.stringify({ ...META, pmcid: "PMC1000002", is_pmc_openaccess: false });
      },
    });
    const result = await fetchLiterature(OPTIONS, ports);
    expect(result.skipped).toEqual([
      { pmcid: "PMC1000001", reason: "retracted" },
      { pmcid: "PMC1000002", reason: "not-open-access" },
      { pmcid: "PMC1000003", reason: "not-in-dataset" },
    ]);
  });
});
