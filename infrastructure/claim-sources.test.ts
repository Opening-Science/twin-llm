import { describe, expect, test } from "bun:test";

import {
  answerClaims,
  claimCoverage,
  referenceSources,
  sourcesByLabel,
  splitCites,
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

  test("a sentence ending in the word no still ends there", () => {
    const claims = answerClaims(
      reply(
        "The evidence for magnesium says no. Coffee late in the day delays sleep [PMC1234567].",
      ),
      parts,
    );
    expect(claims.map((claim) => [claim.text, claim.status])).toEqual([
      ["The evidence for magnesium says no.", "uncited"],
      ["Coffee late in the day delays sleep.", "cited"],
    ]);
  });

  test("an id-shaped link text is a link, never a citation", () => {
    const [claim] = answerClaims(
      reply(
        "The full study is [PMC1234567](https://pmc.example.org/PMC1234567) on the web.",
      ),
      parts,
    );
    expect(claim?.status).toBe("uncited");
    expect(claim?.sources).toEqual([]);
  });

  test("an id inside a code fence is no claim", () => {
    const claims = answerClaims(
      reply(
        "```\nSleep studies report longer nights [PMC1234567].\n```\nCoffee late in the day delays sleep.",
      ),
      parts,
    );
    expect(claims.map((claim) => [claim.text, claim.status])).toEqual([
      ["Coffee late in the day delays sleep.", "uncited"],
    ]);
  });

  test("a source or an invented id cited twice in one sentence counts once", () => {
    const [claim] = answerClaims(
      reply(
        "Sleep studies [PMC1234567] report longer nights [PMC1234567], not [made-up-2023] or [made-up-2023].",
      ),
      parts,
    );
    expect(claim?.sources.map((source) => source.label)).toEqual(["PMC1234567"]);
    expect(claim?.unknown).toEqual(["made-up-2023"]);
  });

  test("an id inside inline code is not read, as the answer does not mark it", () => {
    const [claim] = answerClaims(
      reply("Ids look like `[PMC9999999]` in the text you see here."),
      parts,
    );
    expect(claim).toMatchObject({ status: "uncited", unknown: [] });
  });

  test("table cells are read as the answer renders them, header and separator left out", () => {
    const claims = answerClaims(
      reply(
        "| Measure | Finding |\n| --- | --- |\n| Sleep | Sleep studies report longer nights [PMC1234567]. |\n| Ventilation | Not covered by any search here [esc-ccs-2019]. |",
      ),
      parts,
    );
    expect(claims.map((claim) => [claim.text, claim.status])).toEqual([
      ["Sleep studies report longer nights.", "cited"],
      ["Not covered by any search here.", "invented"],
    ]);
  });

  test("a reply without headings is read whole", () => {
    expect(
      answerClaims("The guideline covers ventilation [ean-als-2024].", parts),
    ).toHaveLength(1);
  });
});

describe("sentence ends around marks (#847)", () => {
  const statuses = (answer: string) =>
    answerClaims(reply(answer), parts).map((claim) => [claim.text, claim.status]);

  test("a bold sentence ends at its stop, inside the bold", () => {
    expect(
      statuses(
        "**Riluzole is the standard first therapy.** Sleep quality falls with age in adults [PMC1234567].",
      ),
    ).toEqual([
      ["**Riluzole is the standard first therapy.**", "uncited"],
      ["Sleep quality falls with age in adults.", "cited"],
    ]);
  });

  test("a quoted sentence ends at its stop, inside the quotes", () => {
    expect(
      statuses(
        'The guideline says "offer riluzole early." Sleep quality falls with age [PMC1234567].',
      ),
    ).toEqual([
      ['The guideline says "offer riluzole early."', "uncited"],
      ["Sleep quality falls with age.", "cited"],
    ]);
  });

  test("a stop inside brackets, then the id, ends the sentence", () => {
    expect(
      statuses(
        "Riluzole slows the disease (by a few months.) [ean-als-2024] Next we look at sleep in adults.",
      ),
    ).toEqual([
      ["Riluzole slows the disease (by a few months.)", "cited"],
      ["Next we look at sleep in adults.", "uncited"],
    ]);
  });

  test("No. ends a sentence unless a number follows", () => {
    expect(
      statuses(
        "Does sleep drop with age? No. [PMC1234567] Riluzole is offered early in every case.",
      ),
    ).toEqual([
      ["Does sleep drop with age?", "uncited"],
      ["Riluzole is offered early in every case.", "uncited"],
    ]);
    expect(statuses("Trial No. 4 found longer sleep in adults [PMC1234567].")).toEqual([
      ["Trial No. 4 found longer sleep in adults.", "cited"],
    ]);
  });

  test("a sentence wrapped over two lines is one claim", () => {
    expect(
      statuses("Sleep quality falls with age\nin most adults [PMC1234567]."),
    ).toEqual([["Sleep quality falls with age in most adults.", "cited"]]);
  });

  test("a new bullet still starts a new sentence", () => {
    expect(
      statuses(
        "- Sleep quality falls with age\n- Riluzole is offered early [ean-als-2024].",
      ),
    ).toEqual([
      ["Sleep quality falls with age", "uncited"],
      ["Riluzole is offered early.", "cited"],
    ]);
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

describe("splitCites", () => {
  test("cuts a run into text and bracketed citations, leaving other brackets as text", () => {
    const sources = referenceSources(parts);
    const pieces = splitCites(
      "Ventilation helps [ean-als-2024, PMC7654321] and [hrv.daily] [unsupported].",
      sources,
    );
    expect(pieces.map((piece) => piece.kind)).toEqual([
      "text",
      "cites",
      "text",
      "cites",
      "text",
    ]);
    expect(pieces[1]).toMatchObject({
      kind: "cites",
      tokens: [
        { kind: "source", label: "ean-als-2024" },
        { kind: "invented", label: "PMC7654321" },
      ],
    });
    expect(pieces[2]).toEqual({ kind: "text", text: " and [hrv.daily] " });
    expect(pieces[3]).toMatchObject({ tokens: [{ kind: "unsupported" }] });
  });

  test("keeps words that are no id inside a citation group", () => {
    const [, cites] = splitCites(
      "Ventilation helps [ean-als-2024, table 2].",
      referenceSources(parts),
    );
    expect(cites).toMatchObject({
      kind: "cites",
      tokens: [
        { kind: "source", label: "ean-als-2024" },
        { kind: "text", label: "table 2" },
      ],
    });
    const [claim] = answerClaims(
      reply("Ventilation helps in most cases [ean-als-2024, table 2]."),
      parts,
    );
    expect(claim).toMatchObject({ status: "cited", unknown: [] });
  });

  test("sourcesByLabel keys a stored list as referenceSources does", () => {
    const stored = [...referenceSources(parts).values()];
    expect([...sourcesByLabel(stored).keys()]).toEqual([
      ...referenceSources(parts).keys(),
    ]);
  });
});
