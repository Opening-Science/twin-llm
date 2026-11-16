import { describe, expect, test } from "bun:test";

import {
  answerClaims,
  claimCoverage,
  referenceSources,
  type ClaimSourcePart,
} from "./claim-sources";

/** A `guideline_search` hit as the tool returns it (`toGuidelineHit`). */
const guideline = {
  id: "ean-als-2024",
  title: "EAN/ERN EURO-NMD guideline on ALS",
  year: 2024,
  society: "EAN",
  doi: "10.0000/example",
  url: "https://example.org/ean-als-2024",
  licence: "cc-by-nc-nd-4.0",
  ingestMode: "full_text",
  sectionHeading: "Non-invasive ventilation",
  recommendationId: "R3",
  recClass: "Strong",
  evidenceLevel: "moderate",
  page: "12",
  passage: "Synthetic passage.",
};

/** A literature hit from an agent's `knowledge_search` (`toLiteratureHit`). */
const article = {
  kind: "literature",
  id: "lit-sleep-PMC1234567.1",
  specialty: "sleep",
  title: "A synthetic sleep study",
  journal: "Example Journal",
  year: 2022,
  pmcid: "PMC1234567",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/",
  doi: "",
  licence: "cc-by",
  licenceLabel: "CC BY",
  sectionHeading: "Results",
  passage: "Synthetic passage.",
  attribution: "…",
  quoting: "…",
  about: "…",
};

/** An OpenTwin note from `knowledge_search`. */
const note = {
  id: "metric-hrv",
  title: "Heart rate variability",
  file: "metrics/hrv.md",
  sectionHeading: "What it measures",
  licence: "MIT",
  passage: "Synthetic note.",
};

const parts: readonly ClaimSourcePart[] = [
  { output: [guideline] },
  { output: [note, article] },
  { output: { rows: [{ value: 42 }] } },
];

const reply = (answer: string): string =>
  `## Reasoning\nSearched.\n\n## Evidence Used\n- none\n\n## Answer\n${answer}\n\n## Uncertainty\nSome.`;

describe("referenceSources", () => {
  test("lists guideline, article and note hits by the ids an answer may write", () => {
    const sources = referenceSources(parts);
    expect(sources.get("ean-als-2024")).toEqual({
      label: "ean-als-2024",
      kind: "guideline",
      title: guideline.title,
      url: guideline.url,
      year: 2024,
    });
    expect(sources.get("pmc1234567")?.kind).toBe("article");
    expect(sources.get("lit-sleep-pmc1234567.1")?.title).toBe(article.title);
    expect(sources.get("metric-hrv")).toMatchObject({ kind: "note", url: "" });
  });

  test("ignores outputs that are not search hits", () => {
    expect(
      referenceSources([{ output: [{ value: 1 }] }, { output: "text" }, {}]).size,
    ).toBe(0);
  });
});

describe("answerClaims", () => {
  test("links a sentence to the source it names, before or after its stop", () => {
    const claims = answerClaims(
      reply(
        "Ventilation is recommended in the guideline [ean-als-2024]. Sleep studies report longer nights. [PMC1234567]",
      ),
      parts,
    );
    expect(claims.map((claim) => [claim.text, claim.status])).toEqual([
      ["Ventilation is recommended in the guideline.", "cited"],
      ["Sleep studies report longer nights.", "cited"],
    ]);
    expect(claims[0]?.sources[0]?.url).toBe(guideline.url);
  });

  test("an id no search returned is invented, never a source", () => {
    const [claim] = answerClaims(
      reply("Statins lower LDL in most adults [esc-ccs-2019]."),
      parts,
    );
    expect(claim).toMatchObject({
      status: "invented",
      sources: [],
      unknown: ["esc-ccs-2019"],
    });
  });

  test("[unsupported] marks a claim; a bare claim is uncited", () => {
    const claims = answerClaims(
      reply(
        "Magnesium may help sleep [unsupported]. Coffee late in the day delays sleep.",
      ),
      parts,
    );
    expect(claims.map((claim) => claim.status)).toEqual(["unsupported", "uncited"]);
    expect(claims[0]?.marked).toBe(true);
  });

  test("reads several ids in one bracket and keeps a returned one over an invented one", () => {
    const [claim] = answerClaims(
      reply("Both sources agree on early ventilation [ean-als-2024; PMC7654321]."),
      parts,
    );
    expect(claim?.status).toBe("cited");
    expect(claim?.unknown).toEqual(["PMC7654321"]);
  });

  test("leaves wearable keys, footnotes and links in the text and reads only Answer", () => {
    const claims = answerClaims(
      reply(
        "- Your HRV was 52 ms [hrv.daily.2026-01-02].\n- See [the guideline](https://example.org) for more.",
      ),
      parts,
    );
    expect(claims.map((claim) => claim.text)).toEqual([
      "Your HRV was 52 ms [hrv.daily.2026-01-02].",
      "See [the guideline](https://example.org) for more.",
    ]);
    expect(claims.every((claim) => claim.status === "uncited")).toBe(true);
  });

  test("keeps decimals and abbreviations inside one sentence and skips short fragments", () => {
    const claims = answerClaims(
      reply(
        "# Summary\nA 2.5 kg change, e.g. after a month, is common [PMC1234567]. In short:",
      ),
      parts,
    );
    expect(claims.map((claim) => claim.text)).toEqual([
      "A 2.5 kg change, e.g. after a month, is common.",
    ]);
  });

  test("a reply without headings is read whole", () => {
    expect(
      answerClaims("The guideline covers ventilation [ean-als-2024].", parts),
    ).toHaveLength(1);
  });
});

describe("claimCoverage", () => {
  test("counts claims by status", () => {
    const claims = answerClaims(
      reply(
        "One claim is cited here [ean-als-2024]. One claim is marked here [unsupported]. One claim has an invented id [esc-pe-2019]. One claim has nothing at all.",
      ),
      parts,
    );
    expect(claimCoverage(claims)).toEqual({
      claims: 4,
      cited: 1,
      unsupported: 1,
      invented: 1,
      uncited: 1,
    });
  });
});
