import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SuggestedQuestions } from "./suggested-questions";
import { SuggestionChips } from "./suggestion-chips";

const render = (suggestions: SuggestedQuestions): string =>
  renderToStaticMarkup(
    createElement(SuggestionChips, { suggestions, onPick: () => undefined }),
  );

describe("SuggestionChips (#454)", () => {
  test("the heading, then a pill per question titled with the prompt it writes", () => {
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
    expect(html).toContain('<section aria-label="Suggested questions"');
    expect(html).toContain(
      '<p class="text-muted-foreground text-xs">From Synthetic person 1, synthetic</p>',
    );
    expect(html).toContain(
      'title="For synthetic subject synthetic-subject-1, using LOINC 8867-4, what was their latest heart rate?">What was their latest heart rate?</button>',
    );
    // A prompt that is the label needs no title.
    expect(html).toContain('font-normal">Show a chart of my HRV.</button>');
  });

  test("no questions leaves nothing above the prompt", () => {
    expect(render({ heading: "", questions: [] })).toBe("");
  });
});
