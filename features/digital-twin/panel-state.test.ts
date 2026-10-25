import { describe, expect, test } from "bun:test";

import { activePanelTab } from "./body-panel";
import { initialPanel, panelReducer } from "./panel-state";

describe("panelReducer", () => {
  const hovered = panelReducer(initialPanel, { type: "hover", id: "head.vertex" });

  test("hover sets and clears the lit row", () => {
    expect(hovered).toEqual({ ...initialPanel, hoverId: "head.vertex" });
    expect(panelReducer(hovered, { type: "hover", id: null })).toEqual(initialPanel);
    expect(panelReducer(hovered, { type: "hover", id: "head.vertex" })).toBe(hovered);
  });

  test("a new search clears the hover, so a filtered-out row stops lighting", () => {
    expect(panelReducer(hovered, { type: "query", query: "knee" })).toEqual({
      ...initialPanel,
      query: "knee",
    });
  });

  test("a tab switch clears the hover and keeps the search", () => {
    const searched = { ...hovered, query: "knee" };
    expect(panelReducer(searched, { type: "tab", tab: "measures" })).toEqual({
      ...initialPanel,
      query: "knee",
      tab: "measures",
    });
  });

  test("the no-value section remembers the person's choice", () => {
    expect(panelReducer(initialPanel, { type: "other", open: true }).otherOpen).toBe(
      true,
    );
  });
});

describe("activePanelTab", () => {
  const offered = ["properties", "markers", "measures", "biomarkers"] as const;
  const empty = { properties: 0, markers: 0, measures: 0, biomarkers: 0 };

  test("follows the data until the person picks a tab", () => {
    expect(activePanelTab(null, offered, empty)).toBe("properties");
    // Measurements arrive after the panel mounted: they open, not a fallback.
    expect(activePanelTab(null, offered, { ...empty, measures: 3, biomarkers: 67 })).toBe(
      "measures",
    );
    expect(activePanelTab("markers", offered, { ...empty, measures: 3 })).toBe("markers");
  });

  test("a picked tab that is no longer offered falls back to the default", () => {
    expect(activePanelTab("measures", ["biomarkers"], { ...empty, biomarkers: 67 })).toBe(
      "biomarkers",
    );
  });
});
