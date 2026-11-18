import { describe, expect, test } from "bun:test";

import { TOOLS_IN_WORDS, toolDoes, toolTitle } from "@/infrastructure/tool-titles";

import {
  BUILT_IN_COMMANDS,
  builtInDraft,
  type Command,
  matchCommands,
  ownLine,
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

  test("the built-ins are connect, which reads nothing, and twin and compact, which say what they read", () => {
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
      {
        name: "compact",
        description:
          "Draft a short note of this thread for your memory. Nothing is saved until you confirm it.",
        reads: [
          "this thread's prompts and answers, sent to its model",
          "tool names and date ranges, never their rows",
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
  test("a skill lists its sources by label, and its tools line words them without ids", () => {
    expect(SLEEP_COMMAND).toEqual({
      name: "sleep",
      description: "Chart the last 7 or 30 nights of sleep.",
      reads: ["Subjects and observations", "Your linked wearables"],
      tools: ["coverage", "baseline_deviation"],
      kind: "skill",
    });
    expect(toolsLine(SLEEP_COMMAND.tools ?? [])).toBe(
      "may use: checks data coverage, compares with a baseline",
    );
    expect(toolsLine([])).toBe("uses no tools");
  });

  test("a person's own skill says it is theirs and not evaluated; a shipped one says nothing", () => {
    const own = skillCommand({
      name: "my-sleep",
      description: "My sleep.",
      sources: ["wearable-context"],
      tools: [],
      own: true,
    });
    expect(own.own).toBe(true);
    expect(ownLine(own)).toBe("Yours · not evaluated");
    expect(SLEEP_COMMAND.own).toBeUndefined();
    expect(ownLine(SLEEP_COMMAND)).toBeNull();
  });

  test("the may-use line says what tools do, never a step an answer took (#503)", () => {
    const line = toolsLine(TOOLS_IN_WORDS);
    expect(line).toBe(`may use: ${TOOLS_IN_WORDS.map(toolDoes).join(", ")}`);
    expect(TOOLS_IN_WORDS.filter((tool) => line.includes(toolTitle(tool)))).toEqual([]);
  });

  test("built-ins come first, and a skill cannot take a built-in's name", () => {
    const clash = { ...SLEEP_COMMAND, name: "connect" };
    const twinClash = { ...SLEEP_COMMAND, name: "twin" };
    const compactClash = { ...SLEEP_COMMAND, name: "compact" };
    expect(
      paletteCommands([SLEEP_COMMAND, clash, twinClash, compactClash]).map((c) => [
        c.name,
        c.kind,
      ]),
    ).toEqual([
      ["connect", undefined],
      ["twin", undefined],
      ["compact", undefined],
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

  test("the skill's name in any case is that skill, as the palette matches it", () => {
    expect(skillDraft("/Sleep last 30 nights", skills)).toEqual({
      skill: SLEEP_COMMAND,
      prompt: "last 30 nights",
    });
    expect(skillDraft("/SLEEP", skills)?.skill).toEqual(SLEEP_COMMAND);
  });

  test("anything else is an ordinary prompt", () => {
    expect(skillDraft("/sleepy last nights", skills)).toBeNull();
    expect(skillDraft("/connect oura", skills)).toBeNull();
    expect(skillDraft("how did I sleep? /sleep", skills)).toBeNull();
    expect(skillDraft("/sleep last nights", [])).toBeNull();
  });
});

describe("builtInDraft", () => {
  test("a box holding only a built-in is that command, however it is sent", () => {
    expect(builtInDraft("/twin")?.name).toBe("twin");
    expect(builtInDraft("  /compact \n")?.name).toBe("compact");
    expect(builtInDraft("/Connect")?.name).toBe("connect");
  });

  test("a built-in with text after it, a skill or an unknown word is not one", () => {
    expect(builtInDraft("/twin show my heart")).toBeNull();
    expect(builtInDraft("/sleep")).toBeNull();
    expect(builtInDraft("/twins")).toBeNull();
    expect(builtInDraft("what is /twin")).toBeNull();
  });
});
