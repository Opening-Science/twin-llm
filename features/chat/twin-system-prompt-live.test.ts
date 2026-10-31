import { describe, expect, test } from "bun:test";

import { buildTwinSystemPrompt } from "./twin-system-prompt";

const noWearables = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
} as const;

const liveSection = (prompt: string): string => {
  const start = prompt.indexOf("## Live public lookups");
  return start === -1 ? "" : prompt.slice(start, prompt.indexOf("\n\n", start));
};

describe("system prompt with live public lookups (#6)", () => {
  test("names only the live tools this turn carries", () => {
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "personal",
      offeredTools: new Set(["pubmed_search"]),
    });
    expect(liveSection(prompt)).toBe(
      [
        "## Live public lookups",
        "- `pubmed_search` sends its terms to a public database off this machine. Put in only general topic words, a gene symbol or an rsID; never a value, date, name or identifier from the person's data.",
        "- Cite what you use by the PMID or Ensembl URL the tool returns. It is reference material, never evidence about this person.",
      ].join("\n"),
    );
  });

  test("with no live tool the prompt is unchanged", () => {
    const without = buildTwinSystemPrompt({
      ...noWearables,
      mode: "synthetic",
      offeredTools: new Set(["list_subjects"]),
    });
    const withBoth = buildTwinSystemPrompt({
      ...noWearables,
      mode: "synthetic",
      offeredTools: new Set(["list_subjects", "pubmed_search", "ensembl_lookup"]),
    });
    expect(liveSection(without)).toBe("");
    expect(withBoth.replace(`${liveSection(withBoth)}\n\n`, "")).toBe(without);
    expect(liveSection(withBoth)).toContain(
      "`pubmed_search` and `ensembl_lookup` send their terms",
    );
  });
});
