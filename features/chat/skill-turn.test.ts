import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { AppendInput } from "@/packages/audit/append";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { createChatTools, createTurnTools, forSkill, forSources } from "./chat-tools";
import type { ResponseDocumentV1, ResponseToolCall } from "./response/document-v1";
import { runTwinTurn } from "./run-twin-turn";
import { runShowView } from "./show-view-tool";

/**
 * A turn run under a skill, against the real chat tool set with a fake model
 * and fake query ports: the model is offered only the skill's tools (after the
 * user's source choices and the data-mode policy), the system prompt carries
 * the skill's instructions and names nothing else, and the response document
 * records the skill.
 */

const SLEEP: TurnSkill = {
  name: "sleep",
  description: "Chart the last 7 or 30 nights of sleep.",
  tools: [
    "subject_window",
    "coverage",
    "summary_stats",
    "trend",
    "baseline_deviation",
    "knowledge_search",
  ],
  sources: [
    "cohort-records",
    "cohort-analytics",
    "opentwin-knowledge",
    "wearable-context",
  ],
  providers: ["ollama"],
  views: ["chart.timeseries", "chart.compare"],
  instructions: "Use sleep duration, LOINC 93832-4, for the subject the question names.",
};

const ports: QueryToolPorts = {
  findSubject: async () => null,
  findObservations: async () => [],
  appendAudit: async () => undefined,
};

const SCOPE = { actor: "test", sessionId: "turn-skill", mode: "synthetic" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const ANSWER =
  "## Reasoning\nRead rows.\n\n## Evidence Used\n- none\n\n## Answer\nShort.\n\n## Uncertainty\nSome.";

const answer = () => ({
  stream: new ReadableStream({
    start: (controller) => {
      [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: ANSWER },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ].forEach((part) => controller.enqueue(part as never));
      controller.close();
    },
  }),
});

const auditRow = (seq: number, tool: string, rowCount: number): ResponseToolCall => ({
  seq,
  tool,
  args_sha256: "a".repeat(64),
  result_sha256: "b".repeat(64),
  row_count: rowCount,
  ts: "2026-10-26T08:00:00.000Z",
});

const runSkillTurn = async (
  skill: TurnSkill | null,
  disabled: readonly KnowledgeSourceId[] = [],
) => {
  const model = new MockLanguageModelV4({ doStream: async () => answer() });
  const { tools, offeredTools } = forSkill(
    forSources(createChatTools(SCOPE, { query: ports, views: skill?.views }), disabled)
      .tools,
    skill,
  );
  const document = await new Promise<ResponseDocumentV1>((resolve, reject) => {
    const result = runTwinTurn(
      {
        model,
        tools,
        offeredTools,
        mode: "synthetic",
        skill,
        loadAudit: async () => [
          auditRow(7, "skill.sleep", 0),
          auditRow(8, "baseline_deviation", 12),
        ],
      },
      {
        turnId: "turn-skill",
        messages: [{ role: "user", content: "Last 7 nights for subject s-1." }],
        wearables: NO_WEARABLES,
      },
      {
        onFirstToken: () => undefined,
        onFinish: async ({ buildDocument }) => resolve(await buildDocument()),
        onError: async (error) => reject(error),
        onAbort: () => reject(new Error("aborted")),
      },
    );
    void result.consumeStream();
  });
  const call = model.doStreamCalls[0];
  const system = call?.prompt[0];
  return {
    tools: (call?.tools ?? []).map((tool) => tool.name).sort(),
    system: system && system.role === "system" ? system.content : "",
    document,
  };
};

describe("a turn run under a skill", () => {
  test("the model is offered the skill's tools and the view tools, nothing else", async () => {
    const { tools } = await runSkillTurn(SLEEP);
    expect(tools).toEqual([
      "baseline_deviation",
      "coverage",
      "knowledge_search",
      "list_views",
      "open_view",
      "show_view",
      "subject_window",
      "summary_stats",
      "trend",
    ]);
  });

  test("a source the user turned off stays off under a skill", async () => {
    const { tools } = await runSkillTurn(SLEEP, [
      "cohort-analytics",
      "opentwin-knowledge",
    ]);
    expect(tools).toEqual([
      "list_views",
      "open_view",
      "show_view",
      "subject_window",
      "summary_stats",
    ]);
  });

  test("a skill without a kind show_view draws gets no view tools", async () => {
    const { tools, system } = await runSkillTurn({ ...SLEEP, views: [] });
    expect(tools).not.toContain("show_view");
    expect(tools).not.toContain("list_views");
    expect(tools).not.toContain("open_view");
    expect(system).not.toContain("show_view");
    expect(system).not.toContain("open_view");
  });

  test("the prompt carries the skill's instructions and names only offered tools", async () => {
    const { system } = await runSkillTurn(SLEEP);
    expect(system).toContain(
      [
        "## Skill: /sleep",
        "The person ran /sleep: Chart the last 7 or 30 nights of sleep.",
        "Follow these instructions for this turn. They do not change the headings above.",
        "",
        "Use sleep duration, LOINC 93832-4, for the subject the question names.",
      ].join("\n"),
    );
    expect(system).toContain(
      "- Use the `subject_ref` the question names. Never invent one.\n- Fetch rows with `subject_window` and `summary_stats`.",
    );
    ["list_subjects", "latest_by_loinc", "gbd_population", "guideline_search"].forEach(
      (tool) => expect(system).not.toContain(tool),
    );
  });

  test("the response document names the skill; the skill-run row is not a tool call", async () => {
    const { document } = await runSkillTurn(SLEEP);
    expect(document.skill).toBe("sleep");
    expect(document.data_basis.tool_calls.map((row) => row.tool)).toEqual([
      "baseline_deviation",
    ]);
    expect(document.uncertainty.reasons).not.toContain("tool_returned_no_rows");
  });

  test("an ordinary turn has no skill on its document and every tool", async () => {
    const { document, tools, system } = await runSkillTurn(null);
    expect(document.skill).toBeUndefined();
    expect(tools).toContain("list_subjects");
    expect(system).not.toContain("## Skill:");
  });
});

describe("show_view under a skill", () => {
  test("a kind the skill does not list is refused before anything is read", async () => {
    const audits: AppendInput[] = [];
    const output = await runShowView(
      {
        scope: SCOPE,
        ports: {
          ...ports,
          appendAudit: async (input) => {
            audits.push(input);
            return undefined;
          },
        },
        wearables: NO_WEARABLES,
        cohortRecords: true,
        views: ["chart.compare"],
      },
      {
        kind: "chart.timeseries",
        measure: "93832-4",
        window: { start: "2026-09-24", end: "2026-09-30" },
        subject: "synthetic-subject-1",
      },
    );
    expect(output).toEqual({
      code: "VIEW_NOT_ALLOWED",
      error: "this view kind is not allowed for the skill this turn runs",
    });
    expect(audits).toEqual([]);
  });

  test("a skill without cohort-records reads no subject through show_view", async () => {
    const reads: unknown[] = [];
    const tools = createChatTools(SCOPE, {
      query: {
        ...ports,
        findObservations: async (query) => {
          reads.push(query);
          return [];
        },
      },
      views: ["twin.body"],
      sources: ["opentwin-knowledge", "wearable-context"],
    });
    const output = await tools.show_view.execute?.(
      { kind: "twin.body", focus: "liver", subject: "synthetic-subject-1" },
      { toolCallId: "call-1", messages: [] },
    );
    expect(output).toEqual({
      code: "RECORDS_NOT_IN_SKILL",
      error:
        "this skill reads no subject records; call show_view again without subject (twin.body) or with a wearable key",
    });
    expect(reads).toEqual([]);
  });
});

describe("createTurnTools", () => {
  test("is the chat tools after source choices and the skill's list", () => {
    const names = (tools: object) => Object.keys(tools).sort();
    const composed = forSkill(
      forSources(
        createChatTools(SCOPE, {
          query: ports,
          views: SLEEP.views,
          sources: SLEEP.sources,
        }),
        ["gbd"],
      ).tools,
      SLEEP,
    );
    const built = createTurnTools(
      SCOPE,
      { query: ports, disabledSources: ["gbd"] },
      SLEEP,
    );
    expect(names(built.tools)).toEqual(names(composed.tools));
    expect([...built.offeredTools].sort()).toEqual([...composed.offeredTools].sort());
    expect(names(createTurnTools(SCOPE, { query: ports }, null).tools)).toEqual(
      names(createChatTools(SCOPE, { query: ports })),
    );
  });
});
