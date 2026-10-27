import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { WITHHELD_SENTENCE, withholdAdvice } from "./answer-filter";
import { askCarbonX, carbonXHealth } from "./client";
import { startFakeCarbonX } from "./fake-carbon-x";
import { genomeToolList } from "./manifest";
import { buildCarbonXMessages, CARBON_X_SYSTEM, type VariantContext } from "./prompt";
import { dnaAskInput } from "./schema";

const VARIANT: VariantContext = {
  rsid: "rs4244285",
  gene: "CYP2C19",
  allele: "*2",
  geneNote: "a liver enzyme",
  chromosome: "chr10",
  position: 94781859,
  build: "GRCh38",
  reference: "G",
  genotype: "A/G",
  windowStart: 94781856,
  flank: 3,
  referenceWindow: "ACTGCAT",
  alternates: [{ allele: "A", sequence: "ACTACAT" }],
};

const fake = await startFakeCarbonX();
const failing = await startFakeCarbonX({ status: 500 });
const slow = await startFakeCarbonX({ delayMs: 300 });

afterAll(() => {
  fake.stop();
  failing.stop();
  slow.stop();
});

describe("buildCarbonXMessages", () => {
  test("DNA only inside <dna> tags, reference and alternate windows, genotype named", () => {
    expect(buildCarbonXMessages(VARIANT)).toEqual([
      { role: "system", content: CARBON_X_SYSTEM },
      {
        role: "user",
        content: [
          "Variant rs4244285 at chr10:94781859 (GRCh38, 1-based), reference allele G.",
          "Gene CYP2C19 (a liver enzyme); this site defines CYP2C19 *2 in the CPIC / PharmGKB allele tables.",
          "Recorded genotype: A/G.",
          "",
          "Reference window, chr10:94781856 onward, 3 bp each side, reference allele G:",
          "<dna>ACTGCAT</dna>",
          "Alternate window with A in place of G:",
          "<dna>ACTACAT</dna>",
          "",
          "Describe what this variant is known to affect, and how the alternate sequence differs from the reference.",
        ].join("\n"),
      },
    ]);
  });

  test("a homozygous reference call says there is no alternate window", () => {
    const [, user] = buildCarbonXMessages(
      { ...VARIANT, genotype: "G/G", alternates: [] },
      "Is this site in an exon?",
    );
    expect(user?.content).toContain(
      "Both recorded alleles equal the reference, so there is no alternate window.",
    );
    expect(user?.content.endsWith("Is this site in an exon?")).toBe(true);
    expect(user?.content.match(/<dna>/g)?.length).toBe(1);
  });

  test("the system message forbids dosing and medicine advice", () => {
    expect(CARBON_X_SYSTEM).toContain(
      "Never give clinical advice, dosing, or a recommendation to start, stop or change any medicine.",
    );
  });
});

describe("askCarbonX against the sidecar contract", () => {
  test("POSTs model carbon-x to /v1/chat/completions and returns the text", async () => {
    const messages = buildCarbonXMessages(VARIANT);
    const answer = await askCarbonX({ baseUrl: fake.baseUrl, timeoutMs: 2000 }, messages);
    expect(answer).toEqual({
      ok: true,
      text: "The alternate allele changes a splice site in exon 5, which is reported to produce a non-functional enzyme.",
    });
    expect(fake.received.at(-1)).toEqual({
      model: "carbon-x",
      messages: messages.map((message) => ({ ...message })),
      temperature: 0,
      max_tokens: 512,
      stream: false,
    } as never);
  });

  test("health is GET /health on the server root", async () => {
    expect(await carbonXHealth({ baseUrl: fake.baseUrl, timeoutMs: 2000 })).toBe(true);
    expect(
      await carbonXHealth({ baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 200 }),
    ).toBe(false);
  });

  test("a URL off this machine is refused before any request", async () => {
    const calls: string[] = [];
    const answer = await askCarbonX(
      {
        baseUrl: "https://carbon.example.org/v1",
        timeoutMs: 1000,
        fetch: (async (url: string) => {
          calls.push(url);
          return Response.json({});
        }) as unknown as typeof fetch,
      },
      buildCarbonXMessages(VARIANT),
    );
    expect(answer).toEqual({ ok: false, code: "CARBON_X_NOT_LOCAL" });
    expect(calls).toEqual([]);
  });

  test("a sidecar error becomes a code; its text never comes back", async () => {
    expect(
      await askCarbonX(
        { baseUrl: failing.baseUrl, timeoutMs: 2000 },
        buildCarbonXMessages(VARIANT),
      ),
    ).toEqual({ ok: false, code: "CARBON_X_FAILED" });
  });

  test("a slow sidecar times out", async () => {
    expect(
      await askCarbonX(
        { baseUrl: slow.baseUrl, timeoutMs: 50 },
        buildCarbonXMessages(VARIANT),
      ),
    ).toEqual({ ok: false, code: "CARBON_X_TIMEOUT" });
  });

  test("nothing listening is unreachable", async () => {
    expect(
      await askCarbonX(
        { baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 500 },
        buildCarbonXMessages(VARIANT),
      ),
    ).toEqual({ ok: false, code: "CARBON_X_UNREACHABLE" });
  });
});

describe("withholdAdvice", () => {
  test("a descriptive answer passes unchanged", () => {
    const text =
      "CYP2C19*2 is a splice defect. It is reported to remove enzyme activity.";
    expect(withholdAdvice(text)).toEqual({ text, withheld: 0 });
  });

  test("dosing and medicine-change sentences are withheld and counted", () => {
    expect(
      withholdAdvice(
        "CYP2C19*2 is a splice defect. Carriers should avoid clopidogrel. A dose of 75 mg is typical. It reduces enzyme activity.",
      ),
    ).toEqual({
      text: `CYP2C19*2 is a splice defect. It reduces enzyme activity.\n\n${WITHHELD_SENTENCE}`,
      withheld: 2,
    });
  });
});

describe("dna_ask input", () => {
  test("takes an rsID only; coordinates or a genotype are refused", () => {
    expect(dnaAskInput.safeParse({ rsid: "rs4244285" }).success).toBe(true);
    expect(dnaAskInput.safeParse({ rsid: "chr10:94781859" }).success).toBe(false);
    expect(dnaAskInput.safeParse({ rsid: "rs4244285", genotype: "A/G" }).success).toBe(
      false,
    );
  });
});

describe("genome tool schema snapshot", () => {
  test("the slim model-facing schemas equal the committed snapshot", () => {
    const snapshot: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "__snapshots__/genome-tools.json"), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(genomeToolList()))).toEqual(snapshot);
  });
});
