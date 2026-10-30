import { z } from "zod";

import handWritten from "@/evaluation/agent-router.v1.json";
import questions from "@/evaluation/agent-router.questions.v1.json";

import { type RouterItem } from "./roster";

/**
 * The two router fixtures `infrastructure/agent-router.test.ts` measures Auto
 * on (docs/agents.md, "Measuring the router"): the hand-written prompts and
 * the 130 scored questions, each labelled with the agent it should go to.
 * Committed files, read at build time; no person's data.
 */

const fixtureSchema = z.object({
  items: z.array(
    z.object({ id: z.string().optional(), prompt: z.string(), expected: z.string() }),
  ),
});

/** The items of one fixture, or none when it no longer has that shape. */
export const fixtureItems = (fixture: unknown): readonly RouterItem[] => {
  const parsed = fixtureSchema.safeParse(fixture);
  return parsed.success ? parsed.data.items : [];
};

export const HAND_WRITTEN_ITEMS = fixtureItems(handWritten);
export const QUESTION_ITEMS = fixtureItems(questions);
export const ROUTER_ITEMS: readonly RouterItem[] = [
  ...QUESTION_ITEMS,
  ...HAND_WRITTEN_ITEMS,
];
