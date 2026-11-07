import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NO_COHORT_BODY, NO_TRAINING_SETS_BODY } from "./explorer-copy";
import { NoCohortPanel } from "./explorer-header";
import { NoTrainingSets } from "./training-browser";

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The Data page's empty states say who can fill them, never a command (#480). */
describe("Data page setup panels", () => {
  test("no cohort: the title and who can load one", () => {
    expect(text(renderToStaticMarkup(createElement(NoCohortPanel)))).toBe(
      `No synthetic cohort loaded on this machine ${NO_COHORT_BODY}`,
    );
  });

  test("no training sets: the title and who can write a sample", () => {
    expect(text(renderToStaticMarkup(createElement(NoTrainingSets)))).toBe(
      `No training conversations yet ${NO_TRAINING_SETS_BODY}`,
    );
  });
});
