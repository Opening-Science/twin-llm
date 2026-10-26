import { describe, expect, test } from "bun:test";

import { BUILT_IN_COMMANDS, type Command, matchCommands, readsLine } from "./registry";

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

  test("the built-in list has connect, which reads nothing", () => {
    expect(BUILT_IN_COMMANDS).toEqual([
      { name: "connect", description: "Connect a wearable", reads: [] },
    ]);
  });
});

describe("readsLine", () => {
  test("names what a command reads, or says it reads nothing", () => {
    expect(readsLine([])).toBe("reads nothing");
    expect(readsLine(["oura", "whoop"])).toBe("reads: oura, whoop");
  });
});
