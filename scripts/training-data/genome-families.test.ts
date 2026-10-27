import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ARK_PANEL, reportFor } from "../genome-synth/ark-report";
import { parseCatalog, type Variant } from "../genome-synth/catalog";
import { callsFor } from "../genome-synth/genotypes";
import { stableUuid } from "../synthetic-wearables/bundle";
import { randomFor } from "../synthetic-wearables/random";

import { renderSections } from "./conversation";
import { type Draft, draftsFor, type Family, GENOME_FAMILIES } from "./families";
import {
  dnaAskResult,
  genomeReportResult,
  genomeVariant,
  REPORT_SOURCE,
  STAND_IN_SOURCE,
} from "./genome-families";
import { GENOME_TEMPLATES } from "./genome-questions";
import { addTypo } from "./questions";

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(
    readFileSync(join(import.meta.dir, "../genome-synth/variants.tsv"), "utf8"),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const REF = "080b069b-5108-46b6-ecef-6aacd3b9ef3f";

const context = (subjectRef: string, random: () => number) => ({
  subjectRef,
  random,
  anchorDay: "2026-10-01",
  outsideRef: "outside-1",
  hasWearables: true,
  run: async () => {
    throw new Error("genome families never call a query tool");
  },
  genomeCatalog: catalog(),
});

const text = (draft: Draft): string =>
  draft.reply.kind === "refuse" ? draft.reply.text : renderSections(draft.reply.sections);

/** Genome drafts for many synthetic subjects, every family on. */
const many = async (count: number): Promise<Array<Draft & { ref: string }>> => {
  const all: Array<Draft & { ref: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const ref = stableUuid(`genome-families:${index}`);
    const { random: _unused, ...rest } = context(ref, () => 0);
    const drafts = await draftsFor(
      rest,
      (family: Family) => randomFor(7, `conversation:${ref}:${family}`),
      new Set(GENOME_FAMILIES),
    );
    all.push(...drafts.map((draft) => ({ ...draft, ref })));
  }
  return all;
};

const genotypeAt = (ref: string, rsid: string): string | null => {
  const call = callsFor(ref, catalog()).find((entry) => entry.variant.rsid === rsid);
  if (!call || call.altCopies === null) return null;
  const { ref: r, alt } = call.variant;
  return [`${r}/${r}`, `${r}/${alt}`, `${alt}/${alt}`][call.altCopies] ?? null;
};

describe("genome tool results", () => {
  test("genome_report has the shape runGenomeReport returns, from the synthetic report", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../features/chat/genome-tools.ts"),
      "utf8",
    );
    expect(source).toContain(`source: "${REPORT_SOURCE}"`);
    const result = genomeReportResult(
      reportFor(callsFor(REF, catalog()), catalog()),
      "2026-10-01T09:00:00.000Z",
    );
    expect(Object.keys(result)).toEqual([
      "source",
      "released_at",
      "build",
      "rows",
      "note",
    ]);
    expect(result.rows).toHaveLength(11);
    expect(result.rows[0]).toEqual({
      rsid: "rs4244285",
      gene: "CYP2C19",
      allele: "*2",
      gene_note: "a liver cytochrome P450 enzyme that breaks down many medicines",
      chromosome: "chr10",
      position: 94781859,
      reference: "G",
      genotype: "G/A",
    });
    expect(result.build).toBe("GRCh38");
  });

  test("dna_ask has the shape runDnaAsk returns, and says it is a stand-in", () => {
    const call = callsFor(REF, catalog())[0];
    if (!call) throw new Error("no call");
    expect(dnaAskResult(call)).toEqual({
      source: STAND_IN_SOURCE,
      rsid: "rs4244285",
      gene: "CYP2C19",
      allele: "*2",
      site: "chr10:94781859 (GRCh38)",
      genotype: "G/A",
      answer:
        "rs4244285 lies in CYP2C19 (GRCh38 chr10:94781859 G>A). Consequence: synonymous variant. ClinVar lists: drug response, likely benign, other.",
      withheld_sentences: 0,
      note: "Research model output about a DNA sequence. Not clinical advice and not a basis for any dosing or medicine decision.",
    });
    expect(STAND_IN_SOURCE).not.toBe("Carbon-X (research model)");
  });
});

describe("genome families", () => {
  test("one variant question: genome_report, then dna_ask, then the answer", () => {
    // 0.3: the fourth panel site, a formal template, no typo.
    const draft = genomeVariant(context(REF, () => 0.3));
    const call = callsFor(REF, catalog())[3];
    if (!call) throw new Error("no call");
    expect(draft).toEqual({
      family: "genome_variant",
      question:
        "My genome report shows C/T at rs1799853. What is known about this variant?",
      template: {
        id: "genomeVariant.formal.1",
        group: "genomeVariant.formal",
        style: "formal",
        typo: false,
      },
      measureLoinc: null,
      subjectRef: REF,
      calls: [
        {
          name: "genome_report",
          args: {},
          result: genomeReportResult(
            reportFor(callsFor(REF, catalog()), catalog()),
            "2026-10-01T09:00:00.000Z",
          ),
        },
        { name: "dna_ask", args: { rsid: "rs1799853" }, result: dnaAskResult(call) },
      ],
      outcome: "answered",
      reply: {
        kind: "sections",
        sections: {
          reasoning:
            "I called `genome_report`; the released report records C/T at rs1799853. I then called `dna_ask` for rs1799853; its answer is labelled as a synthetic stand-in for the research model.",
          answer:
            'Your report records C/T at rs1799853: one copy of the reference allele C and one of T. rs1799853 is a CYP2C9 site that defines the *2 allele (CYP2C9: a liver cytochrome P450 enzyme that breaks down many medicines). The answer `dna_ask` returned, labelled "Synthetic stand-in for Carbon-X (research model): training data, not model output", says: rs1799853 lies in CYP2C9 (GRCh38 chr10:94942290 C>T). Consequence: missense variant. ClinVar lists: drug response, likely benign, other. This is research information only: it does not say what the genotype means for any medicine, dose or condition.',
          uncertainty:
            "One site does not define a star allele or a metaboliser status, and a research genotype is not a clinical test; a clinician or pharmacist can order one. The genotypes are synthetic (TwinLLM genome-synth) and describe no real person.",
        },
      },
    });
  });

  test("over many subjects: every family appears and every answer is true to the report", async () => {
    const drafts = await many(300);
    expect(new Set(drafts.map((draft) => draft.family))).toEqual(
      new Set(GENOME_FAMILIES),
    );
    for (const draft of drafts) {
      const reply = text(draft);
      expect(draft.question).not.toMatch(/\{[a-z]+\}/);
      const names = draft.calls.map((call) => call.name);
      const asked = draft.calls.flatMap((call) =>
        call.name === "dna_ask" ? [String(call.args.rsid)] : [],
      );
      switch (draft.family) {
        case "genome_variant":
        case "genome_variants":
          expect(names).toEqual(["genome_report", ...asked.map(() => "dna_ask")]);
          for (const rsid of asked) {
            const genotype = genotypeAt(draft.ref, rsid);
            expect(genotype).not.toBeNull();
            expect(reply).toContain(`${genotype} at ${rsid}`);
          }
          expect(reply).toContain("research information only");
          expect(draft.outcome).toBe("answered");
          break;
        case "genome_no_call": {
          // The real dna_ask refuses a no-call site, so it is not called.
          expect(names).toEqual(["genome_report"]);
          const rsid = /no call at (rs\d+)/.exec(reply)?.[1] ?? "";
          expect(genotypeAt(draft.ref, rsid)).toBeNull();
          expect((ARK_PANEL as readonly string[]).includes(rsid)).toBe(true);
          expect(reply).toContain("A no call is not the reference genotype");
          break;
        }
        case "genome_not_in_report": {
          expect(names).toEqual(["genome_report"]);
          const rsid = /(rs\d+) is not one of them/.exec(reply)?.[1] ?? "";
          expect((ARK_PANEL as readonly string[]).includes(rsid)).toBe(false);
          break;
        }
        case "genome_decline_dose":
          expect(reply).toStartWith("REFUSE: ");
          expect(names).toEqual([]);
          break;
        case "genome_other_person":
          expect(names).toEqual([]);
          expect(draft.subjectRef).toBeNull();
          break;
        case "genome_hosted_provider":
          expect(names).toEqual([]);
          expect(reply).toContain("I will not send your genome report");
          break;
      }
      // No answer names a dose, an amount or a medicine change.
      if (draft.reply.kind === "sections") {
        expect(reply).not.toMatch(
          /\b\d+\s?mg\b|increase the dose|reduce the dose|you should take/i,
        );
      }
    }
  });

  test("templates: four styles per slot, and a typo never touches a placeholder", () => {
    expect(GENOME_TEMPLATES.length).toBe(58);
    const placeholders = (value: string) => value.match(/\{[a-z]+\}/g) ?? [];
    for (const [index, template] of GENOME_TEMPLATES.entries()) {
      const slipped = addTypo(randomFor(index, "genome-typo"), template.text);
      expect(placeholders(slipped)).toEqual(placeholders(template.text));
    }
  });
});
