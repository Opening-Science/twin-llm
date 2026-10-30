import { describe, expect, test } from "bun:test";

import type { TurnSkill } from "@/infrastructure/skill-gate";
import { NOTES_HEADING, twinNotesBlock } from "@/infrastructure/twin-notes";

import { buildTwinSystemPrompt } from "./twin-system-prompt";

/** The twin notes block in the system prompt (#43): where it goes, and only when given. */

const BASE = {
  mode: "synthetic",
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
} as const;

const SKILL: TurnSkill = {
  name: "sleep",
  description: "Chart the last nights of sleep.",
  tools: [],
  sources: [],
  providers: ["ollama"],
  views: [],
  instructions: "Describe sleep.",
};

const BLOCK = twinNotesBlock([
  {
    id: "n1",
    title: "Heart rate in spring",
    topics: ["Heart rate over spring"],
    measures: [],
    openQuestions: [],
    dataMode: "synthetic",
    permit: "synthetic",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
]).text;

describe("twin notes in the system prompt", () => {
  test("absent or empty, the prompt is unchanged", () => {
    const without = buildTwinSystemPrompt(BASE);
    expect(buildTwinSystemPrompt({ ...BASE, twinNotes: "" })).toBe(without);
    expect(buildTwinSystemPrompt({ ...BASE, twinNotes: null })).toBe(without);
    expect(without).not.toContain(NOTES_HEADING);
  });

  test("after the wearable context and before a skill, so the skill keeps the last word", () => {
    const prompt = buildTwinSystemPrompt({ ...BASE, twinNotes: BLOCK, skill: SKILL });
    const notesAt = prompt.indexOf(NOTES_HEADING);
    expect(notesAt).toBeGreaterThan(prompt.indexOf("## Wearable context (BodyLoop)"));
    expect(notesAt).toBeLessThan(prompt.indexOf("## Skill: /sleep"));
    expect(prompt.endsWith("Describe sleep.")).toBe(true);
  });
});
