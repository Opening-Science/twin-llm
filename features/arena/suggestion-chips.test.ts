import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SuggestedQuestions } from "./suggested-questions";
import { SuggestionChips } from "./suggestion-chips";

const render = (suggestions: SuggestedQuestions): string =>
  renderToStaticMarkup(
    createElement(SuggestionChips, { suggestions, onPick: () => undefined }),
  );

/** The paragraphs' text, in order. Classes are left out on purpose. */
const paragraphs = (html: string): readonly string[] =>
  [...html.matchAll(/<p\b[^>]*>([^<]*)<\/p>/g)].map((match) => match[1] ?? "");

/** Each button's label and title (null when it has none), in order. */
const buttons = (html: string): readonly (readonly [string, string | null])[] =>
  [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((match) => [
    match[2] ?? "",
    /\btitle="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? null,
  ]);

describe("SuggestionChips (#454)", () => {
  test("the heading, then a pill per question showing only its short question (#480)", () => {
    const html = render({
      heading: "From Synthetic person 1, synthetic",
      questions: [
        {
          label: "What was their latest heart rate?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 8867-4, what was their latest heart rate?",
        },
        { label: "Show a chart of my HRV.", prompt: "Show a chart of my HRV." },
      ],
    });
    expect(html).toMatch(/^<section\b[^>]*\baria-label="Suggested questions"/);
    expect(paragraphs(html)).toEqual(["From Synthetic person 1, synthetic"]);
    // The grounded prompt is for the model; not even a tooltip shows it.
    expect(buttons(html)).toEqual([
      ["What was their latest heart rate?", null],
      ["Show a chart of my HRV.", null],
    ]);
    expect(html).not.toContain("synthetic-subject-1");
    expect(html).not.toContain("LOINC");
  });

  test("no questions leaves nothing above the prompt", () => {
    expect(render({ heading: "", questions: [] })).toBe("");
  });
});
