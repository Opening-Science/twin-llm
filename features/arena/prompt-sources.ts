import type { LiveSourceId } from "@/infrastructure/live-sources";

/**
 * The `@` menu of the prompt bar (#366): the sources this person can point a
 * question at here, from what is actually linked and allowed.
 *
 * Picking one writes `@Name` into the question. That is a word in the
 * question, read by the model like any other; it does not switch a tool on
 * or off, and every permit applies as it would without it. "Import a file"
 * is the existing import page, not an upload from the bar.
 */

export type PromptSourceFacts = Readonly<{
  /** The imported-data policy allows this server's chat to read them. */
  imported: boolean;
  /** The genome policy allows a chat turn the genome report or an imported VCF. */
  genome: boolean;
  /** The live lookups this person switched on, none in local-only mode. */
  live: readonly LiveSourceId[];
}>;

export const NO_SOURCE_FACTS: PromptSourceFacts = Object.freeze({
  imported: false,
  genome: false,
  live: [],
});

export type LinkedWearables = Readonly<{
  oura: boolean;
  whoop: boolean;
  googleHealth: boolean;
}>;

export type PromptSource = Readonly<{
  key: string;
  name: string;
  description: string;
  /** Set for the one row that opens a page instead of writing a mention. */
  href?: string;
}>;

/** Where files are imported today (Customize · Data). */
export const IMPORT_HREF = "/customize/data";

const LIVE: Readonly<Record<LiveSourceId, PromptSource>> = {
  pubmed: {
    key: "pubmed",
    name: "PubMed",
    description: "Published articles, live from NCBI",
  },
  ensembl: {
    key: "ensembl",
    name: "Ensembl",
    description: "A gene or rsID, live from Ensembl",
  },
};

export const promptSources = (
  facts: PromptSourceFacts,
  wearables: LinkedWearables,
): readonly PromptSource[] => [
  ...(wearables.oura
    ? [{ key: "oura", name: "Oura", description: "Your linked Oura summary" }]
    : []),
  ...(wearables.whoop
    ? [{ key: "whoop", name: "Whoop", description: "Your linked Whoop summary" }]
    : []),
  ...(wearables.googleHealth
    ? [
        {
          key: "google-health",
          name: "Google Health",
          description: "Your linked Google Health summary",
        },
      ]
    : []),
  ...(facts.imported
    ? [
        {
          key: "imported",
          name: "Imported data",
          description: "Records and tables you imported",
        },
      ]
    : []),
  ...(facts.genome
    ? [{ key: "genome", name: "Genome", description: "Your released genome report" }]
    : []),
  ...facts.live.map((id) => LIVE[id]),
  {
    key: "files",
    name: "Import a file",
    description: "Opens Customize · Data",
    href: IMPORT_HREF,
  },
];

/** Sources whose name starts a word with the query, in their order. */
export const matchSources = (
  sources: readonly PromptSource[],
  query: string,
): readonly PromptSource[] =>
  query === ""
    ? sources
    : sources.filter((source) =>
        source.name
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(query)),
      );
