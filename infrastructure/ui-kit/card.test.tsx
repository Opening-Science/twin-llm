import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Card } from "./card";

describe("Card", () => {
  test("defaults to a div surface with medium padding", () => {
    expect(renderToStaticMarkup(<Card>x</Card>)).toBe('<div class="surface p-4">x</div>');
  });

  test("takes an article element, a padding step and an extra class", () => {
    expect(
      renderToStaticMarkup(
        <Card as="article" padding="lg" className="opacity-60">
          x
        </Card>,
      ),
    ).toBe('<article class="surface p-6 opacity-60">x</article>');
  });
});
