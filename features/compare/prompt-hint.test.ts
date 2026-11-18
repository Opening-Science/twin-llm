import { describe, expect, test } from "bun:test";

import { INCOGNITO_HINT, INCOGNITO_NOWHERE, promptHint } from "./prompt-hint";

const BASE = {
  skill: null,
  incognito: false,
  anyLocal: true,
  dropped: null,
  problem: null,
  modeLine: "One answer.",
} as const;

describe("the hint line under the composer (SPEC 3.3)", () => {
  test("a skill wins and says what it reads", () => {
    expect(
      promptHint({
        ...BASE,
        incognito: true,
        skill: { name: "sleep", reads: ["linked wearables"] },
      }),
    ).toBe("Sends with /sleep, which reads: linked wearables.");
  });

  test("incognito: local only, or nowhere to go", () => {
    expect(promptHint({ ...BASE, incognito: true })).toBe(INCOGNITO_HINT);
    expect(promptHint({ ...BASE, incognito: true, anyLocal: false })).toBe(
      INCOGNITO_NOWHERE,
    );
  });

  test("dropped models: one, several, none left", () => {
    expect(promptHint({ ...BASE, dropped: { dropped: 1, remaining: 2 } })).toContain(
      "One of this thread's models",
    );
    expect(promptHint({ ...BASE, dropped: { dropped: 2, remaining: 1 } })).toContain(
      "2 of this thread's models",
    );
    expect(promptHint({ ...BASE, dropped: { dropped: 2, remaining: 0 } })).toContain(
      "Choose one",
    );
  });

  test("then what the mode is missing, else its line", () => {
    expect(promptHint({ ...BASE, problem: "Pick at least one model." })).toBe(
      "Pick at least one model.",
    );
    expect(promptHint(BASE)).toBe("One answer.");
  });
});
