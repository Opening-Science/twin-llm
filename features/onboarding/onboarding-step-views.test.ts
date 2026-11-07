import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PurposeStep } from "./onboarding-step-views";
import { DEMO_MISSING_HINT, EMPTY_ANSWERS } from "./onboarding-steps";

const purpose = (demo: boolean) =>
  renderToStaticMarkup(
    createElement(PurposeStep, {
      answers: EMPTY_ANSWERS,
      dataModeNote: "",
      demo,
      onToggleRole: () => undefined,
      onDataChoice: () => undefined,
    }),
  );

const radios = (markup: string) => markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];

describe("the purpose step's data choices (#477)", () => {
  test("without synthetic people the demo cannot be picked and says why", () => {
    const markup = purpose(false);
    const [demo, own] = radios(markup);
    expect(demo).toContain("disabled");
    expect(own).not.toContain("disabled");
    expect(markup).toContain(DEMO_MISSING_HINT);
  });

  test("with synthetic people both can be picked", () => {
    const markup = purpose(true);
    expect(radios(markup).every((radio) => !radio.includes("disabled"))).toBe(true);
    expect(markup).not.toContain(DEMO_MISSING_HINT);
  });
});
