import { describe, expect, test } from "bun:test";

import {
  chosenSources,
  type ConsentEntry,
  privacyView,
  SOURCE_CHOICES,
} from "./privacy-view";

const AT = new Date("2026-10-31T12:00:00Z");

const entry = (overrides: Partial<ConsentEntry> = {}): ConsentEntry => ({
  id: "c-1",
  userId: "u-1",
  scope: "training",
  sources: ["wearables", "chat"],
  wordingVersion: "learning-consent.v1",
  wordingSha256: "0".repeat(64),
  grantedAt: new Date("2026-10-30T09:00:00Z"),
  withdrawnAt: null,
  wording: "I agree.",
  ...overrides,
});

describe("privacyView", () => {
  test("every scope is off with no consent", () => {
    expect(privacyView([], AT)).toEqual([
      {
        scope: "training",
        name: "Training",
        purpose: "Training sets, the conversations a model is fine-tuned on",
        active: null,
        past: [],
      },
      {
        scope: "answer-key",
        name: "Answer keys",
        purpose: "Answer keys, the expected answers a model is checked against",
        active: null,
        past: [],
      },
      {
        scope: "evaluation",
        name: "Evaluation",
        purpose:
          "Evaluation runs, where a model answers questions and its answers are scored",
        active: null,
        past: [],
      },
    ]);
  });

  test("an active grant and a withdrawn one", () => {
    const [training] = privacyView(
      [
        entry(),
        entry({
          id: "c-0",
          sources: ["genome"],
          grantedAt: new Date("2026-10-01T09:00:00Z"),
          withdrawnAt: new Date("2026-10-02T09:00:00Z"),
        }),
      ],
      AT,
    );
    expect(training).toEqual({
      scope: "training",
      name: "Training",
      purpose: "Training sets, the conversations a model is fine-tuned on",
      active: {
        id: "c-1",
        since: "30 Oct 2026",
        sources: "Wearable summaries, chat threads",
        wording: "I agree.",
      },
      past: [
        {
          id: "c-0",
          granted: "1 Oct 2026",
          withdrawn: "2 Oct 2026",
          sources: "Genome reports",
        },
      ],
    });
  });
});

describe("chosenSources", () => {
  test("keeps known sources in the fixed order", () => {
    expect(chosenSources(["chat", "everything", "wearables"])).toEqual([
      "wearables",
      "chat",
    ]);
  });
  test("the choices offered", () => {
    expect(SOURCE_CHOICES.map((choice) => choice.label)).toEqual([
      "Wearable summaries",
      "Imported records",
      "Genome reports",
      "Chat threads",
      "Twin notes",
      "Body scans",
    ]);
  });
});
