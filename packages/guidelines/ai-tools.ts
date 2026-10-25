import { tool } from "ai";

import type { SessionScope } from "@/packages/query-tools/scope";

import { GUIDELINE_ATTRIBUTION_LINE, GUIDELINE_MODEL_TOOL } from "./constants";
import { guidelineSearchInput } from "./input";
import {
  defaultGuidelineSearchPorts,
  runGuidelineSearch,
  type GuidelineSearchPorts,
} from "./search";

export const createGuidelineTools = (
  scope: SessionScope,
  ports?: Partial<GuidelineSearchPorts>,
) => ({
  [GUIDELINE_MODEL_TOOL]: tool({
    description:
      "Search locally stored clinical-guideline passages as reference material. " +
      GUIDELINE_ATTRIBUTION_LINE,
    inputSchema: guidelineSearchInput,
    execute: async (input) =>
      runGuidelineSearch(scope, input, { ...defaultGuidelineSearchPorts(), ...ports }),
  }),
});
