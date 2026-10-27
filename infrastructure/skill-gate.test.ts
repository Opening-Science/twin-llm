import { describe, expect, test } from "bun:test";

import {
  isSkillRefusalCode,
  permitSkillRequest,
  skillAuditTool,
  skillNotOffered,
  skillOfAuditTool,
  skillRunEvent,
  skillSourceLabel,
  type TurnSkill,
  withSkillTools,
} from "./skill-gate";

const SLEEP: TurnSkill = {
  name: "sleep",
  description: "Chart the last nights of sleep.",
  tools: ["subject_window", "coverage", "baseline_deviation", "knowledge_search"],
  sources: [
    "cohort-records",
    "cohort-analytics",
    "opentwin-knowledge",
    "wearable-context",
  ],
  providers: ["ollama"],
  views: ["chart.timeseries", "chart.compare"],
  instructions: "Describe sleep.",
};

describe("permitSkillRequest", () => {
  test("a provider the skill lists may run it", () => {
    expect(
      permitSkillRequest(SLEEP, { provider: "ollama", hasWearableContext: true }),
    ).toEqual({ ok: true });
  });

  test("a provider the skill does not list is refused with a sentence naming both", () => {
    expect(
      permitSkillRequest(SLEEP, { provider: "openrouter", hasWearableContext: false }),
    ).toEqual({
      ok: false,
      code: "provider-not-allowed-by-skill",
      error:
        "/sleep runs only on local Ollama. The models here come from OpenRouter, so /sleep did not run. Ask without /sleep instead.",
    });
  });

  test("several providers are listed with 'or'", () => {
    const decision = permitSkillRequest(
      { ...SLEEP, providers: ["ollama", "exoscale"] },
      { provider: "remote-gpu", hasWearableContext: false },
    );
    expect(decision.ok ? "" : decision.error).toBe(
      "/sleep runs only on local Ollama or Exoscale. The models here come from the remote GPU, so /sleep did not run. Ask without /sleep instead.",
    );
  });

  test("wearable context needs a skill that reads it", () => {
    const cohortOnly = { ...SLEEP, sources: ["cohort-records"] };
    expect(
      permitSkillRequest(cohortOnly, { provider: "ollama", hasWearableContext: true }),
    ).toEqual({
      ok: false,
      code: "source-not-allowed",
      error:
        "/sleep does not read linked wearables, and this question would carry them, so /sleep did not run.",
    });
    expect(
      permitSkillRequest(cohortOnly, { provider: "ollama", hasWearableContext: false }),
    ).toEqual({ ok: true });
  });
});

describe("withSkillTools", () => {
  const turnTools = {
    list_subjects: 1,
    subject_window: 2,
    coverage: 3,
    gbd_population: 4,
    knowledge_search: 5,
    show_view: 6,
    list_views: 7,
    open_view: 8,
  };

  test("keeps only listed tools, and the view tools when a kind show_view draws is allowed", () => {
    expect(withSkillTools(turnTools, SLEEP)).toEqual({
      subject_window: 2,
      coverage: 3,
      knowledge_search: 5,
      show_view: 6,
      list_views: 7,
      open_view: 8,
    });
  });

  test("never adds a tool the turn did not already have", () => {
    expect(withSkillTools({ coverage: 3 }, SLEEP)).toEqual({ coverage: 3 });
  });

  test("drops show_view when the skill allows no kind it draws", () => {
    expect(withSkillTools(turnTools, { ...SLEEP, views: ["twin.body"] })).toEqual({
      subject_window: 2,
      coverage: 3,
      knowledge_search: 5,
    });
    expect(withSkillTools(turnTools, { ...SLEEP, views: [] })).not.toHaveProperty(
      "show_view",
    );
  });
});

describe("skill audit rows", () => {
  test("the row is named after the skill and carries no prompt text", () => {
    expect(
      skillRunEvent(SLEEP, {
        actor: "actor-1",
        sessionId: "turn-1",
        modelId: "qwen3:4b",
        provider: "ollama",
      }),
    ).toEqual({
      actor: "actor-1",
      sessionId: "turn-1",
      subjectRef: null,
      tool: "skill.sleep",
      args: {
        skill: "sleep",
        modelId: "qwen3:4b",
        provider: "ollama",
        tools: SLEEP.tools,
        views: SLEEP.views,
      },
      result: { started: true },
      rowCount: 0,
    });
  });

  test("the skill is read back from the row name, and only from skill rows", () => {
    expect(skillAuditTool("sleep")).toBe("skill.sleep");
    expect(skillOfAuditTool("skill.sleep")).toBe("sleep");
    expect(skillOfAuditTool("coverage")).toBeNull();
    expect(skillOfAuditTool("skill.")).toBeNull();
    expect(skillOfAuditTool("skill.Not A Name")).toBeNull();
  });
});

describe("refusal codes the browser may show", () => {
  test("only skill refusals qualify", () => {
    expect(isSkillRefusalCode("provider-not-allowed-by-skill")).toBe(true);
    expect(isSkillRefusalCode("source-not-allowed")).toBe(true);
    expect(isSkillRefusalCode(skillNotOffered("x").code)).toBe(true);
    expect(isSkillRefusalCode("PROVIDER_NOT_PERMITTED_FOR_DATA_MODE")).toBe(false);
    expect(isSkillRefusalCode(undefined)).toBe(false);
  });

  test("an unknown skill gets a plain sentence", () => {
    expect(skillNotOffered("nap")).toEqual({
      code: "skill-not-offered",
      error:
        "There is no /nap skill on this server, so nothing ran. Type / to see the skills it offers.",
    });
  });
});

describe("skillSourceLabel", () => {
  test("names sources as the onboarding toggles do", () => {
    expect(skillSourceLabel("cohort-records")).toBe("Subjects and observations");
    expect(skillSourceLabel("wearable-context")).toBe("Your linked wearables");
    expect(skillSourceLabel("unknown-source")).toBe("unknown-source");
  });
});
