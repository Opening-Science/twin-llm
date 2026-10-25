import { tool } from "ai";

import { guidelineSearchInput } from "@/packages/guidelines/input";
import type { SessionScope } from "@/packages/query-tools/scope";

import { KNOWLEDGE_MODEL_TOOL } from "./constants";
import {
  defaultKnowledgeSearchPorts,
  runKnowledgeSearch,
  type KnowledgeSearchPorts,
} from "./search";

export const createKnowledgeTools = (
  scope: SessionScope,
  ports?: Partial<KnowledgeSearchPorts>,
) => ({
  [KNOWLEDGE_MODEL_TOOL]: tool({
    description:
      "Search TwinLLM's own OpenTwin knowledge notes: what each wearable metric " +
      "(HRV, heart rate, SpO2, sleep, readiness, recovery, strain, steps, weight) " +
      "measures, its unit and device, LOINC and UCUM codes, where data comes from, " +
      "the audit log, and what the tools can and cannot compute. Reference material " +
      "about TwinLLM, not about this person.",
    inputSchema: guidelineSearchInput,
    execute: async (input) =>
      runKnowledgeSearch(scope, input, { ...defaultKnowledgeSearchPorts(), ...ports }),
  }),
});
