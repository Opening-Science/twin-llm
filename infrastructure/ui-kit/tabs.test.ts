import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const html = renderToStaticMarkup(
  createElement(
    Tabs,
    { defaultValue: "body" },
    createElement(
      TabsList,
      { "aria-label": "Twin views" },
      createElement(TabsTrigger, { value: "body" }, "Body"),
      createElement(TabsTrigger, { value: "scan" }, "Scan"),
    ),
    createElement(TabsContent, { value: "body" }, "Body panel"),
    createElement(TabsContent, { value: "scan" }, "Scan panel"),
  ),
);

const tabs = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

describe("Tabs", () => {
  test("renders a labelled tablist with one tab per trigger", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Twin views"');
    expect(tabs.length).toBe(2);
    expect(tabs.every((t) => t.includes('role="tab"'))).toBe(true);
  });

  test("selects the default tab and only that one", () => {
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(tabs[1]).toContain('aria-selected="false"');
  });

  test("the selected tab controls the visible tabpanel", () => {
    const controls = /aria-controls="([^"]+)"/.exec(tabs[0]!)?.[1];
    expect(controls).toBeDefined();
    expect(html).toContain(`role="tabpanel"`);
    expect(new RegExp(`<div[^>]*id="${controls}"[^>]*>Body panel</div>`).test(html)).toBe(
      true,
    );
    expect(html).not.toContain(">Scan panel<");
  });
});
