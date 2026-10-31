import { tool } from "ai";

import type { SessionScope } from "@/packages/query-tools/scope";

import { ENSEMBL_LOOKUP_TOOL, PUBMED_SEARCH_TOOL } from "./constants";
import { ensemblLookupInput, pubmedSearchInput } from "./input";
import { defaultLiveToolPorts } from "./ports";
import type { LiveTurn } from "./refusals";
import { type LiveToolPorts, runEnsemblLookup, runPubmedSearch } from "./tools";

export const PUBMED_SEARCH_DESCRIPTION =
  "Search PubMed live for published articles on a general topic. The query is sent to NCBI, so write it in words from the topic, never a value, date, name or identifier of the person; numbers are refused except in gene symbols and rsIDs. Returns up to 10 articles with PMID, title, journal, year, DOI and an abstract snippet. Cite each article you use by its PMID and URL. Literature, not evidence about this person.";

export const ENSEMBL_LOOKUP_DESCRIPTION =
  "Look up one human gene by symbol (such as BRCA1) or one variant by rsID (such as rs429358) in Ensembl, live. The symbol or rsID is sent to Ensembl. Returns location, biotype and description for a gene; class, consequence, minor allele frequency and clinical significance for a variant, with the Ensembl URL to cite. Reference facts, not a statement about this person.";

/**
 * Only the sources this turn's person switched on get a tool; with none on,
 * this returns no tools and the prompt never names them. The turn also says
 * whether the chat is incognito and whether the person's genome is part of
 * it, and every call checks both again before anything is sent.
 */
export const createLiveSourceTools = (
  scope: SessionScope,
  turn: LiveTurn,
  ports?: Partial<LiveToolPorts>,
) => {
  const all = (): LiveToolPorts => ({ ...defaultLiveToolPorts(), ...ports });
  return {
    ...(turn.enabled.includes("pubmed")
      ? {
          [PUBMED_SEARCH_TOOL]: tool({
            description: PUBMED_SEARCH_DESCRIPTION,
            inputSchema: pubmedSearchInput,
            execute: async (input) => runPubmedSearch(scope, input, turn, all()),
          }),
        }
      : {}),
    ...(turn.enabled.includes("ensembl")
      ? {
          [ENSEMBL_LOOKUP_TOOL]: tool({
            description: ENSEMBL_LOOKUP_DESCRIPTION,
            inputSchema: ensemblLookupInput,
            execute: async (input) => runEnsemblLookup(scope, input, turn, all()),
          }),
        }
      : {}),
  };
};
