import { describe, expect, test } from "bun:test";

import type { OuraSummary } from "@/infrastructure/oura-types";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { type ChatToolFactories, createChatTools } from "./chat-tools";
import { createShowViewTool } from "./show-view-tool";
import { createViewTools } from "./view-tools";
import { createGbdTools } from "@/packages/gbd-mcp/ai-tools";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { createQueryTools } from "@/packages/query-tools/ai-tools";

/**
 * The turn's wearable snapshots reach `show_view` and the query factory (for
 * its four wearable tools) and nothing else. Every
 * factory is wrapped in a spy that records its arguments; the test then walks
 * those arguments for the sentinel snapshots. No source text is matched.
 */

const ports: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  appendAudit: async () => undefined,
};

const SCOPE = { actor: "test", sessionId: "turn-wear", mode: "synthetic" } as const;

const sentinel = (name: string): OuraSummary => ({
  window: { startDate: "2026-10-01", endDate: "2026-10-31" },
  metrics: [{ key: `${name}.2026-10-01`, label: name, value: 1, date: "2026-10-01" }],
  narrative: `sentinel-${name}`,
});

const wearables = {
  oura: sentinel("oura"),
  whoop: sentinel("whoop"),
  googleHealth: sentinel("google"),
  vitronic: null,
};
const SENTINELS: readonly unknown[] = [
  wearables,
  wearables.oura,
  wearables.whoop,
  wearables.googleHealth,
];

/** True when a sentinel snapshot is `value` or anywhere inside it. */
const reaches = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (SENTINELS.includes(value)) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => reaches(child, seen));
};

type Calls = Record<keyof ChatToolFactories, unknown[][]>;

const spied = (): { factories: ChatToolFactories; calls: Calls } => {
  const calls: Calls = {
    query: [],
    showView: [],
    views: [],
    gbd: [],
    guidelines: [],
    knowledge: [],
  };
  const spy =
    <A extends unknown[], R>(name: keyof Calls, factory: (...args: A) => R) =>
    (...args: A): R => {
      calls[name].push(args);
      return factory(...args);
    };
  return {
    calls,
    factories: {
      query: spy("query", createQueryTools),
      showView: spy("showView", createShowViewTool),
      views: spy("views", createViewTools),
      gbd: spy("gbd", createGbdTools),
      guidelines: spy("guidelines", createGuidelineTools),
      knowledge: spy("knowledge", createKnowledgeTools),
    },
  };
};

describe("wearable snapshots in the chat tools", () => {
  test("only the show_view and query factories are given them", () => {
    const { factories, calls } = spied();
    const tools = createChatTools(SCOPE, { query: ports, wearables, factories });
    expect(Object.keys(tools)).toContain("gbd_population");
    expect(Object.keys(tools)).toContain("guideline_search");
    expect(calls.showView.length).toBe(1);
    expect((calls.showView[0]?.[0] as { wearables: unknown }).wearables).toBe(wearables);
    expect(reaches(calls.showView[0])).toBe(true);
    expect(calls.query.length).toBe(1);
    expect(calls.query[0]?.[2]).toBe(wearables);
    for (const name of ["views", "gbd", "guidelines", "knowledge"] as const) {
      expect(calls[name].length).toBe(1);
      expect(calls[name].map((args) => reaches(args))).toEqual([false]);
    }
  });
});

describe("an agent's literature in the chat tools (#236)", () => {
  test("knowledge_search gets the agent's specialty, every one for the GP, none without an agent", () => {
    const literatureOf = (agent: string | null | undefined): unknown => {
      const { factories, calls } = spied();
      createChatTools(SCOPE, { query: ports, factories, agent });
      return calls.knowledge[0]?.[2];
    };
    expect(literatureOf(undefined)).toEqual([]);
    expect(literatureOf(null)).toEqual([]);
    expect(literatureOf("sleep")).toEqual(["literature:sleep"]);
    expect(literatureOf("gp")).toEqual([
      "literature:gp",
      "literature:diet",
      "literature:anatomy",
      "literature:sleep",
      "literature:trainer",
      "literature:genetics",
    ]);
  });
});
