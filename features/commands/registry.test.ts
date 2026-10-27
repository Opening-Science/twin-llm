import { describe, expect, test } from "bun:test";

import {
  BUILT_IN_COMMANDS,
  type Command,
  matchCommands,
  paletteCommands,
  readsLine,
  skillCommand,
  skillDraft,
  toolsLine,
} from "./registry";

const commands: readonly Command[] = [
  { name: "sleep", description: "Sleep summary", reads: ["oura", "whoop"] },
  { name: "connect", description: "Connect a wearable", reads: [] },
  { name: "compact", description: "Twin note", reads: ["memory"] },
];

describe("matchCommands", () => {
  test("an empty query lists every command in registry order", () => {
    expect(matchCommands("", commands).map((c) => c.name)).toEqual([
      "sleep",
      "connect",
      "compact",
    ]);
  });

  test("matches a prefix of the name, case-insensitively, keeping order", () => {
    expect(matchCommands("Co", commands).map((c) => c.name)).toEqual([
      "connect",
      "compact",
    ]);
    expect(matchCommands("comp", commands).map((c) => c.name)).toEqual(["compact"]);
  });

  test("a substring that is not a prefix matches nothing", () => {
    expect(matchCommands("nect", commands)).toEqual([]);
  });

  test("the built-ins are connect, which reads nothing, and twin, which says what it reads", () => {
    expect(BUILT_IN_COMMANDS).toEqual([
      { name: "connect", description: "Connect a wearable", reads: [] },
      {
        name: "twin",
        description: "Show the digital twin in this chat. Asks no model.",
        reads: [
          "this thread's prompts and tool calls",
          "Body twin: scans, synthetic lab values, linked wearables",
        ],
      },
    ]);
    expect(matchCommands("tw", BUILT_IN_COMMANDS).map((c) => c.name)).toEqual(["twin"]);
  });
});

describe("readsLine", () => {
  test("names what a command reads, or says it reads nothing", () => {
    expect(readsLine([])).toBe("reads nothing");
    expect(readsLine(["oura", "whoop"])).toBe("reads: oura, whoop");
  });
});

const SLEEP_COMMAND = skillCommand({
  name: "sleep",
  description: "Chart the last 7 or 30 nights of sleep.",
  sources: ["cohort-records", "wearable-context"],
  tools: ["coverage", "baseline_deviation"],
});

describe("skills in the palette", () => {
  test("a skill lists its sources by label and its tools by name", () => {
    expect(SLEEP_COMMAND).toEqual({
      name: "sleep",
      description: "Chart the last 7 or 30 nights of sleep.",
      reads: ["Subjects and observations", "Your linked wearables"],
      tools: ["coverage", "baseline_deviation"],
      kind: "skill",
    });
    expect(toolsLine(SLEEP_COMMAND.tools ?? [])).toBe(
      "may call: coverage, baseline_deviation",
    );
    expect(toolsLine([])).toBe("calls no tools");
  });

  test("built-ins come first, and a skill cannot take a built-in's name", () => {
    const clash = { ...SLEEP_COMMAND, name: "connect" };
    const twinClash = { ...SLEEP_COMMAND, name: "twin" };
    expect(
      paletteCommands([SLEEP_COMMAND, clash, twinClash]).map((c) => [c.name, c.kind]),
    ).toEqual([
      ["connect", undefined],
      ["twin", undefined],
      ["sleep", "skill"],
    ]);
  });
});

describe("skillDraft", () => {
  const skills = paletteCommands([SLEEP_COMMAND]);

  test("a prompt starting with a listed skill is that skill and the rest", () => {
    expect(skillDraft("/sleep last 30 nights", skills)).toEqual({
      skill: SLEEP_COMMAND,
      prompt: "last 30 nights",
    });
    expect(skillDraft("  /sleep\nlast 30 nights  ", skills)?.prompt).toBe(
      "last 30 nights",
    );
  });

  test("the bare command asks the skill's own description", () => {
    expect(skillDraft("/sleep ", skills)).toEqual({
      skill: SLEEP_COMMAND,
      prompt: "Chart the last 7 or 30 nights of sleep.",
    });
  });

  test("anything else is an ordinary prompt", () => {
    expect(skillDraft("/sleepy last nights", skills)).toBeNull();
    expect(skillDraft("/connect oura", skills)).toBeNull();
    expect(skillDraft("how did I sleep? /sleep", skills)).toBeNull();
    expect(skillDraft("/sleep last nights", [])).toBeNull();
  });
});
