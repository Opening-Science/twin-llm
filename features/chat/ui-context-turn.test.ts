import { describe, expect, test } from "bun:test";

import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import type { UiContext } from "@/infrastructure/ui-context";

import { chatRequestSchema, incognitoChatRequestSchema } from "./chat-request";
import { buildResponseDocumentV1 } from "./response/build-document";
import { responseDocumentV1Schema } from "./response/document-v1";
import { buildTwinSystemPrompt } from "./twin-system-prompt";

/** The turn's UI context (#47) through the request, the prompt and the document. */

const CONTEXT: UiContext = {
  panels: ["outputs"],
  organ: "liver",
  chart: {
    kind: "biomarker.card",
    measure: "2324-2",
    start: "2026-01-01",
    end: "2026-03-31",
  },
  views: [{ kind: "biomarker.card", measure: "2324-2" }],
  viewCount: 1,
};

const BLOCK = [
  "## UI context",
  'What the person has on screen as they ask; no values. Read "this" or "it" against it.',
  "- open: outputs",
  "- organ: liver",
  "- chart: biomarker.card 2324-2, 2026-01-01 to 2026-03-31",
  "- views in this thread (1, newest first): biomarker.card 2324-2",
].join("\n");

const prompt = (uiContext: UiContext | null) =>
  buildTwinSystemPrompt({
    mode: "synthetic",
    oura: null,
    whoop: null,
    googleHealth: null,
    vitronic: null,
    uiContext,
  });

const REQUEST = {
  modelId: "m",
  turnId: "turn-1",
  messages: [{ role: "user", content: "Why is this high?" }],
};

describe("chat request", () => {
  test("a saved turn may carry a UI context", () => {
    expect(chatRequestSchema.parse({ ...REQUEST, uiContext: CONTEXT }).uiContext).toEqual(
      CONTEXT,
    );
  });

  test("a UI context with a value in it is refused", () => {
    expect(
      chatRequestSchema.safeParse({
        ...REQUEST,
        uiContext: { ...CONTEXT, organ: "liver ALT 80 U/L" },
      }).success,
    ).toBe(false);
  });

  test("an incognito request never carries one", () => {
    const { turnId: _turnId, ...incognito } = REQUEST;
    expect(
      incognitoChatRequestSchema.safeParse({ ...incognito, uiContext: CONTEXT }).success,
    ).toBe(false);
  });
});

describe("system prompt", () => {
  test("adds only the small block, once", () => {
    const withContext = prompt(CONTEXT);
    const without = prompt(null);
    expect(withContext.split("## UI context").length).toBe(2);
    expect(withContext).toBe(`${without}\n\n${BLOCK}`);
  });

  test("an empty context adds nothing", () => {
    expect(
      prompt({ panels: [], organ: null, chart: null, views: [], viewCount: 0 }),
    ).toBe(prompt(null));
  });
});

describe("response document", () => {
  const parsed = parseTwinAnswer("## Answer\nNot enough data.", {
    oura: null,
    whoop: null,
    googleHealth: null,
    vitronic: null,
  });

  test("carries the context the turn was sent with", () => {
    const document = buildResponseDocumentV1({
      parsed,
      toolCalls: [],
      mode: "synthetic",
      uiContext: CONTEXT,
    });
    expect(document.ui_context).toEqual(CONTEXT);
    expect(responseDocumentV1Schema.parse(document).ui_context).toEqual(CONTEXT);
  });

  test("a turn without one leaves the field out", () => {
    const document = buildResponseDocumentV1({
      parsed,
      toolCalls: [],
      mode: "synthetic",
    });
    expect("ui_context" in document).toBe(false);
  });
});
