import { z } from "zod";

import { GUIDELINE_SEARCH_DEFAULT_K, GUIDELINE_SEARCH_MAX_K } from "./constants";

export const guidelineSearchInput = z
  .object({
    query: z.string().trim().min(1).max(2000),
    k: z.number().int().min(1).max(GUIDELINE_SEARCH_MAX_K).default(GUIDELINE_SEARCH_DEFAULT_K),
  })
  .strict();

export type GuidelineSearchInput = z.infer<typeof guidelineSearchInput>;
