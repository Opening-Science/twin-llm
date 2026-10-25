import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThreadRowLabel } from "./nav-panel";
import { modelCountLabel } from "./thread-list";

describe("modelCountLabel", () => {
  test("spells the count out, singular for one", () => {
    expect(modelCountLabel(0)).toBe("0 models");
    expect(modelCountLabel(1)).toBe("1 model");
    expect(modelCountLabel(3)).toBe("3 models");
    expect(modelCountLabel(1200)).toBe("1,200 models");
  });
});

describe("ThreadRowLabel", () => {
  test("shows the title and a visible, labelled model count", () => {
    expect(
      renderToStaticMarkup(
        createElement(ThreadRowLabel, { title: "Sleep and HRV", modelCount: 3 }),
      ),
    ).toBe(
      '<span class="truncate">Sleep and HRV</span><span class="metric shrink-0"><span class="sr-only">, </span>3 models</span>',
    );
  });
});
