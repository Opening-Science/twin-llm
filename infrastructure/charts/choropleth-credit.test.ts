import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Choropleth, type ChoroplethProps } from "./choropleth";

const map = (props: Partial<ChoroplethProps>) =>
  renderToStaticMarkup(
    createElement(Choropleth, {
      title: "Synthetic values",
      unit: null,
      level: "country",
      regions: [{ code: "KE-30", name: "Nairobi", value: 1, lower: null, upper: null }],
      ...props,
    }),
  );

/** The CC BY credit under a map drawn from geoBoundaries (#422). */
describe("Choropleth boundary credit", () => {
  test("a map of Kenya's counties credits geoBoundaries with its licence", () => {
    const html = map({ country: "KEN" });
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Boundaries: geoBoundaries (CC BY 4.0)",
    );
    expect(html).toContain('href="https://www.geoboundaries.org"');
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
  });

  test("Natural Earth maps carry no credit line", () => {
    expect(map({ country: "NGA" })).not.toContain("geoBoundaries");
    expect(map({ level: "world", country: null })).not.toContain("geoBoundaries");
  });
});
