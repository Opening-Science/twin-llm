/**
 * Host CLI: write `evaluation/agent-router.questions.v1.json` from the scored
 * question set, labelled by `routerLabel` (#219). Reads no database.
 *
 *   bun run eval:router-fixture
 */
import { readFile, writeFile } from "node:fs/promises";

import { questionSetSchema } from "./question-set";
import { buildRouterFixture, ROUTER_FIXTURE_SOURCE } from "./router-labels";

export const ROUTER_FIXTURE_OUT = "evaluation/agent-router.questions.v1.json";

const main = async (): Promise<void> => {
  const set = questionSetSchema.parse(
    JSON.parse(await readFile(ROUTER_FIXTURE_SOURCE, "utf8")),
  );
  const fixture = buildRouterFixture(set.items);
  await writeFile(ROUTER_FIXTURE_OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${fixture.items.length} items written to ${ROUTER_FIXTURE_OUT}`);
};

if (Boolean((import.meta as { main?: boolean }).main)) await main();
