import { tool } from "ai";

import { guidelineSearchInput } from "@/packages/guidelines/input";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import type { SessionScope } from "@/packages/query-tools/scope";

import { KNOWLEDGE_MODEL_TOOL } from "./constants";
import {
  defaultKnowledgeSearchPorts,
  runKnowledgeSearch,
  type KnowledgeSearchPorts,
} from "./search";

const NOTES_DESCRIPTION =
  "Search TwinLLM's own OpenTwin knowledge notes: what each wearable metric " +
  "(HRV, heart rate, SpO2, sleep, readiness, recovery, strain, steps, weight) " +
  "measures, its unit and device, LOINC and UCUM codes, where data comes from, " +
  "the audit log, and what the tools can and cannot compute. Reference material " +
  "about TwinLLM, not about this person.";

const LITERATURE_DESCRIPTION =
  " Also searches open-access articles from PubMed Central for this agent's " +
  "specialty: each such hit gives the article title, PMC id and licence. Quote " +
  "an article only word for word with its attribution line; it is reference " +
  "material, never evidence about this person.";

/** The tool text; a turn without an agent's literature keeps the old text. */
export const knowledgeToolDescription = (literatureSources: readonly string[]): string =>
  literatureSources.length > 0
    ? NOTES_DESCRIPTION + LITERATURE_DESCRIPTION
    : NOTES_DESCRIPTION;

/**
 * `literatureSources` is the agent's literature (`literatureSourcesForAgent`);
 * empty, the tool reads the knowledge notes alone.
 */
export const createKnowledgeTools = (
  scope: SessionScope,
  ports?: Partial<KnowledgeSearchPorts>,
  literatureSources: readonly string[] = [],
) => ({
  [KNOWLEDGE_MODEL_TOOL]: tool({
    description: knowledgeToolDescription(literatureSources),
    inputSchema: modelInputSchema(guidelineSearchInput),
    execute: async (input) =>
      runKnowledgeSearch(
        scope,
        input,
        { ...defaultKnowledgeSearchPorts(scope), ...ports },
        literatureSources,
      ),
  }),
});
