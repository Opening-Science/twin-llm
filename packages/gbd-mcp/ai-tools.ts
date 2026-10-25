import { tool } from "ai";

import { createQueryTools } from "@/packages/query-tools/ai-tools";
import type { SessionScope } from "@/packages/query-tools/scope";

import { GBD_MODEL_TOOL } from "./constants";
import { gbdPopulationInput } from "./input";
import { defaultGbdToolPorts, runGbdPopulation, type GbdToolPorts } from "./tools";

export const createGbdTools = (scope: SessionScope, ports?: Partial<GbdToolPorts>) => ({
  [GBD_MODEL_TOOL]: tool({
    description:
      "Look up an IHME GBD population estimate for a closed set of measure, cause, location, year, sex, and age. Population context only — not a statement about a person.",
    inputSchema: gbdPopulationInput,
    execute: async (input) =>
      runGbdPopulation(scope, input, { ...defaultGbdToolPorts(), ...ports }),
  }),
});

export const registerChatTools = (scope: SessionScope) => ({
  ...createQueryTools(scope),
  ...createGbdTools(scope),
});
