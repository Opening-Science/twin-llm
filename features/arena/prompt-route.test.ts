import { describe, expect, test } from "bun:test";

import { BUILT_IN_COMMANDS, skillCommand } from "@/features/commands/registry";

import { isTwinDraft, routeDraft, routePick } from "./prompt-route";
import type { StartTurnInput } from "./start-turn";

/** The prompt bar's handlers with a fake `startTurn` behind `send`, as `useConversation` wires it. */
const recorder = (draft: string) => {
  const startTurnCalls: StartTurnInput[] = [];
  const twinOpens: string[] = [];
  const fakeStartTurn = (input: StartTurnInput) => {
    startTurnCalls.push(input);
  };
  const handlers = {
    send: () =>
      fakeStartTurn({
        threadId: null,
        prompt: draft,
        models: [{ id: "model-a", name: "Model A" }],
      }),
    openTwin: () => {
      twinOpens.push("twin");
    },
  };
  return { startTurnCalls, twinOpens, handlers };
};

const TWIN = BUILT_IN_COMMANDS.find((command) => command.name === "twin") ?? null;

describe("/twin in the prompt bar", () => {
  test("Enter on /twin opens the card and starts no turn", () => {
    const { startTurnCalls, twinOpens, handlers } = recorder("/twin");
    expect(routeDraft("/twin", handlers)).toBe("twin");
    expect(startTurnCalls).toEqual([]);
    expect(twinOpens).toEqual(["twin"]);
  });

  test("surrounding spaces and capitals still mean the command", () => {
    expect(isTwinDraft("  /Twin \n")).toBe(true);
    const { startTurnCalls, handlers } = recorder(" /TWIN ");
    expect(routeDraft(" /TWIN ", handlers)).toBe("twin");
    expect(startTurnCalls).toEqual([]);
  });

  test("picking twin in the palette opens the card and starts no turn", () => {
    const { startTurnCalls, twinOpens, handlers } = recorder("/tw");
    expect(routePick(TWIN, handlers)).toBe(true);
    expect(startTurnCalls).toEqual([]);
    expect(twinOpens).toEqual(["twin"]);
  });

  test("anything else is an ordinary prompt and starts exactly one turn", () => {
    const { startTurnCalls, twinOpens, handlers } = recorder("/twin show me the heart");
    expect(isTwinDraft("/twin show me the heart")).toBe(false);
    expect(routeDraft("/twin show me the heart", handlers)).toBe("send");
    expect(startTurnCalls).toEqual([
      {
        threadId: null,
        prompt: "/twin show me the heart",
        models: [{ id: "model-a", name: "Model A" }],
      },
    ]);
    expect(twinOpens).toEqual([]);
  });

  test("other picks are left to the bar: connect, and a skill named twin", () => {
    const { twinOpens, handlers } = recorder("/");
    const connect = BUILT_IN_COMMANDS.find((command) => command.name === "connect");
    const skill = skillCommand({
      name: "twin",
      description: "A skill cannot take a built-in's name",
      sources: [],
      tools: [],
    });
    expect(routePick(connect ?? null, handlers)).toBe(false);
    expect(routePick(skill, handlers)).toBe(false);
    expect(routePick(null, handlers)).toBe(false);
    expect(twinOpens).toEqual([]);
  });
});
