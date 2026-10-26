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
import { GENOME_TEMPLATES } from "./genome-questions";
import {
  DNA_ASK_TOOL,
  genomeVariant,
  STAND_IN_LABEL,
  standInResult,
} from "./genome-families";
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

describe("genome families", () => {
  test("the stand-in result says what it is", () => {
    const variant = catalog().find((entry) => entry.rsid === "rs4244285");
    if (!variant) throw new Error("no rs4244285");
    expect(standInResult(variant)).toEqual({
      rsid: "rs4244285",
      research_only: true,
      synthetic: true,
      label: STAND_IN_LABEL,
      text: "rs4244285 is in CYP2C19 (GRCh38 chr10:94781859 G>A). Consequence: synonymous variant. ClinVar: drug response, likely benign, other.",
    });
    expect(DNA_ASK_TOOL.function.parameters).toEqual({
      type: "object",
      properties: {
        rsid: {
          type: "string",
          pattern: "^rs[0-9]+$",
          description: "One dbSNP rsID, for example rs4244285.",
        },
      },
      required: ["rsid"],
      additionalProperties: false,
    });
  });

  test("one variant question, answered from the report and the tool", () => {
    // 0.3: the fourth panel site, a formal template, no typo, the report pasted.
    const draft = genomeVariant(context(REF, () => 0.3));
    expect(draft).toEqual({
      family: "genome_variant",
      question:
        "My genome report shows C/T at rs1799853. What is known about this variant?\n\n" +
        reportFor(callsFor(REF, catalog()), catalog()).trimEnd(),
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
          name: "dna_ask",
          args: { rsid: "rs1799853" },
          result: standInResult(catalog()[3] as Variant),
        },
      ],
      outcome: "answered",
      reply: {
        kind: "sections",
        sections: {
          reasoning:
            "Your released report records C/T at rs1799853. I called `dna_ask` for rs1799853; it returned a summary labelled research only and synthetic.",
          answer:
            "rs1799853 lies in CYP2C9 (missense variant); ClinVar lists drug response, likely benign, other. Your report records C/T: one copy of the reference allele C and one of T. This is research information only: it does not say what the genotype means for any medicine, dose or condition.",
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
      const asked = draft.calls.map((call) => String(call.args.rsid));
      expect(draft.calls.every((call) => call.name === "dna_ask")).toBe(true);
      switch (draft.family) {
        case "genome_variant":
        case "genome_variants":
          for (const rsid of asked) {
            const genotype = genotypeAt(draft.ref, rsid);
            expect(genotype).not.toBeNull();
            expect(reply).toContain(`records ${genotype}`);
          }
          expect(reply).toContain("research information only");
          expect(draft.outcome).toBe("answered");
          break;
        case "genome_no_call":
          expect(asked).toHaveLength(1);
          expect(genotypeAt(draft.ref, asked[0] ?? "")).toBeNull();
          expect((ARK_PANEL as readonly string[]).includes(asked[0] ?? "")).toBe(true);
          expect(reply).toContain("A no call is not the reference genotype");
          break;
        case "genome_not_in_report": {
          expect(asked).toEqual([]);
          const rsid = /(rs\d+) is not one of them/.exec(reply)?.[1] ?? "";
          expect((ARK_PANEL as readonly string[]).includes(rsid)).toBe(false);
          expect(draft.question).toContain("Research use only; genotypes as recorded");
          break;
        }
        case "genome_decline_dose":
          expect(reply).toStartWith("REFUSE: ");
          expect(asked).toEqual([]);
          break;
        case "genome_other_person":
          expect(asked).toEqual([]);
          expect(draft.subjectRef).toBeNull();
          break;
        case "genome_hosted_provider":
          expect(asked).toEqual([]);
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
