import { describe, expect, test } from "bun:test";

import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { toChatView } from "@/infrastructure/chat-view";
import type { AppendInput } from "@/packages/audit/append";
import { GBD_MODEL_TOOL } from "@/packages/gbd-mcp/constants";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { createLiveSourceTools } from "@/packages/live-sources/ai-tools";
import { createQueryTools } from "@/packages/query-tools/ai-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import { showViewInput } from "@/packages/query-tools/view-schema";

import { createChatTools } from "./chat-tools";
import type { LocationEstimate, RecordedEstimates } from "./estimate-ledger";
import {
  createShowViewTool,
  MAP_AUDIT_TOOL,
  modelNoteOf,
  runShowView,
} from "./show-view-tool";
import { createViewTools } from "./view-tools";

/**
 * `map.choropleth` through `show_view`: the map's numbers are the rows the
 * turn's estimate lookups returned, never the model's. Every value here is
 * made up.
 */

const SCOPE = { actor: "test", sessionId: "turn-map", mode: "synthetic" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };

const fakePorts = () => {
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => null,
    findObservations: async () => [],
    appendAudit: async (input) => {
      audits.push(input);
      return { seq: BigInt(70 + audits.length), hash: "h" };
    },
  };
  return { ports, audits };
};

const row = (location: string, value: number): LocationEstimate => ({
  location,
  value,
  lower: value - 0.5,
  upper: value + 0.5,
  unit: "%",
  measure: "prevalence",
  cause: "Diabetes mellitus",
  year: "2021",
  sex: "both",
  age: "age_standardized",
  source: "IHME GBD 2021",
});

const RECORDED: readonly RecordedEstimates[] = [
  {
    tool: GBD_MODEL_TOOL,
    callId: "call-1",
    rows: [row("Nigeria", 4.2), row("Ghana", 3.1), row("Global", 6)],
  },
];

const deps = (
  ports: QueryToolPorts,
  recorded: readonly RecordedEstimates[] = RECORDED,
) => ({
  scope: SCOPE,
  ports,
  wearables: NO_WEARABLES,
  cohortRecords: true,
  estimates: () => recorded,
});

describe("map.choropleth", () => {
  test("draws the recorded rows under one audit row", async () => {
    const { ports, audits } = fakePorts();
    const view = await runShowView(deps(ports), { kind: "map.choropleth" });
    expect(view).toEqual({
      id: "view-71",
      kind: "map.choropleth",
      title:
        "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised, by country",
      spec: {
        level: "world",
        country: null,
        measure: "prevalence",
        label: "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised",
        unit: "%",
        source: "IHME GBD 2021",
        subject: null,
        regions: [
          {
            code: "NGA",
            name: "Nigeria",
            location: "Nigeria",
            value: 4.2,
            lower: 3.7,
            upper: 4.7,
          },
          {
            code: "GHA",
            name: "Ghana",
            location: "Ghana",
            value: 3.1,
            lower: 2.6,
            upper: 3.6,
          },
        ],
        unmatched: ["Global"],
        n: 3,
      },
      sourceAuditIds: ["71"],
    });
    expect(audits).toEqual([
      {
        actor: "test",
        sessionId: "turn-map",
        subjectRef: null,
        tool: MAP_AUDIT_TOOL,
        args: { level: "world", country: null, calls: ["call-1"] },
        result: { regions: ["NGA", "GHA"], unmatched: ["Global"] },
        rowCount: 3,
      },
    ]);
    expect(toChatView(view)).toEqual(view as never);
    expect(modelNoteOf(view)).toEqual({
      shown: true,
      view_id: "view-71",
      title:
        "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised, by country",
      places: 2,
      unit: "%",
      not_on_map: ["Global"],
    });
  });

  test("refuses without estimates and writes no audit row", async () => {
    const { ports, audits } = fakePorts();
    const view = await runShowView(deps(ports, []), {
      kind: "map.choropleth",
      level: "country",
    });
    expect(view).toEqual({
      code: "ESTIMATES_REQUIRED",
      error:
        "map.choropleth maps population estimates this turn looked up; look them up first, then call show_view again",
    });
    expect(audits).toEqual([]);
  });

  test("a skill that does not list the kind cannot draw it", async () => {
    const { ports } = fakePorts();
    const view = await runShowView(
      { ...deps(ports), views: ["chart.timeseries"] },
      { kind: "map.choropleth" },
    );
    expect(view).toEqual({
      code: "VIEW_NOT_ALLOWED",
      error: "this view kind is not allowed for the skill this turn runs",
    });
  });

  test("the input schema stays closed: a model cannot pass values", () => {
    const ok = (input: unknown) => showViewInput.safeParse(input).success;
    expect(ok({ kind: "map.choropleth", level: "country" })).toBe(true);
    expect(ok({ kind: "map.choropleth", regions: [{ code: "NGA", value: 1 }] })).toBe(
      false,
    );
    expect(ok({ kind: "map.choropleth", values: [1] })).toBe(false);
    expect(ok({ kind: "map.choropleth", country: "NGA" })).toBe(false);
    expect(ok({ kind: "map.choropleth", level: "continent" })).toBe(false);
  });
});

describe("estimates in a chat turn", () => {
  test("show_view maps what the turn's GBD tool returned", async () => {
    const { ports } = fakePorts();
    const fakeGbd = () => ({
      [GBD_MODEL_TOOL]: tool({
        description: "made-up estimates",
        inputSchema: z.object({}),
        execute: async () => [row("Kenya", 2.5)],
      }),
    });
    const tools = createChatTools(SCOPE, {
      query: ports,
      factories: {
        query: createQueryTools,
        showView: createShowViewTool,
        views: createViewTools,
        gbd: fakeGbd as never,
        guidelines: createGuidelineTools,
        knowledge: createKnowledgeTools,
        live: createLiveSourceTools,
      },
    });
    const options = (toolCallId: string): ToolExecutionOptions => ({
      toolCallId,
      messages: [],
    });
    const gbd = tools[GBD_MODEL_TOOL as keyof typeof tools] as {
      execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>;
    };
    await gbd.execute({}, options("call-k"));
    const view = await tools.show_view.execute?.(
      { kind: "map.choropleth", level: "region" },
      options("call-v"),
    );
    expect(
      view !== undefined && "spec" in view && view.kind === "map.choropleth"
        ? [view.title, view.spec.regions]
        : view,
    ).toEqual([
      "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised, selected countries",
      [{ code: "KEN", name: "Kenya", location: "Kenya", value: 2.5, lower: 2, upper: 3 }],
    ]);
  });
});
